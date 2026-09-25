import type { AgentPromptInput, AgentSkill } from "@/protocol/index.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as createUuid } from "uuid";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { taskQueueQueryKey, type NativeMutationClient } from "../../projects/project-queries.js";
import { resolveIdempotencyAttempt, type IdempotencyAttempt } from "../composer-state.js";
import {
  hasQueuedPromptFinishedInStore,
  mapAgentQueuedSubmission,
  resolveQueuedPromptEdit,
  retainAcceptedSteerPrompt,
  type AcceptedSteerPrompt,
  type QueuedComposerPrompt,
} from "../composer-queue-state.js";
import {
  createPromptSkillContentFromSubmission,
  serializePromptSkillContent,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "../components/prompt-skill-editor.js";

type SubmitPrompt = (
  message: Readonly<{ files: readonly PromptInputAttachment[]; text: string }>,
  skills?: readonly AgentSkill[],
  options?: Readonly<{
    clearInputOnSuccess?: boolean;
    forceAction?: "start" | "steer";
    queuedPromptId?: string;
    requestTimelineScroll?: boolean;
  }>,
) => Promise<boolean>;

type ComposerQueueOptions = Readonly<{
  activeTurnId: string | undefined;
  client: NativeMutationClient;
  handleAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  projectId: string;
  replacePromptContent: (content: PromptSkillContent, cursorOffset?: number) => void;
  routeScope: string;
  runtime: TaskRuntimeView | undefined;
  skillEditorRef: { current: PromptSkillEditorHandle | null };
  skills: readonly AgentSkill[];
  taskId: string | undefined;
}>;

export function useComposerQueue({
  activeTurnId,
  client,
  handleAttachmentsChange,
  projectId,
  replacePromptContent,
  routeScope,
  runtime,
  skillEditorRef,
  skills,
  taskId,
}: ComposerQueueOptions) {
  const queryClient = useQueryClient();
  const queueStartAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const queueAddAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const queryKey = taskQueueQueryKey(projectId, taskId ?? "");
  // client 是稳定的传输实现，不参与队列缓存身份，缓存仍按 projectId 与 taskId 共享。
  // oxlint-disable-next-line @tanstack/query/exhaustive-deps
  const queueQuery = useQuery({
    enabled: taskId !== undefined,
    queryFn: async ({ signal }) => (await client.listQueuedSubmissions(projectId, taskId ?? "", { signal })).data,
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [awaitingSteers, setAwaitingSteers] = useState<
    readonly Readonly<{ prompt: QueuedComposerPrompt; scope: string }>[]
  >([]);
  const serverPrompts = useMemo(
    () =>
      taskId === undefined
        ? []
        : (queueQuery.data ?? []).map((submission) =>
            mapAgentQueuedSubmission(
              submission,
              projectId,
              taskId,
              client.getTaskAttachmentUrl.bind(client),
              skills,
            ),
          ),
    [client, projectId, queueQuery.data, skills, taskId],
  );
  const currentAwaiting = awaitingSteers
    .filter((entry) => entry.scope === routeScope)
    .map((entry) => entry.prompt);
  const awaitingIds = new Set(currentAwaiting.map((prompt) => prompt.id));
  const queuedPrompts = [
    ...serverPrompts.filter((prompt) => !awaitingIds.has(prompt.id)),
    ...currentAwaiting,
  ];

  useEffect(() => {
    const store = runtime?.store;
    if (store === undefined) {
      return undefined;
    }
    return store.subscribe((state) => {
      setAwaitingSteers((current) =>
        current.filter((entry) => {
          if (entry.scope !== routeScope || entry.prompt.status !== "awaiting-response") {
            return true;
          }
          return !hasQueuedPromptFinishedInStore(entry.prompt, state);
        }),
      );
    });
  }, [routeScope, runtime?.store]);

  const invalidateQueue = async () => {
    await queryClient.invalidateQueries({ exact: true, queryKey });
  };
  const startQueued = async (targetTaskId: string, queuedSubmissionId: string) => {
    const attempt = resolveIdempotencyAttempt(queueStartAttempt.current,
      JSON.stringify({ projectId, taskId: targetTaskId, queuedSubmissionId }));
    queueStartAttempt.current = attempt;
    // 失败保留当前尝试；旧请求成功不能清除另一个目标的新尝试。
    const response = await client.startQueuedSubmission(projectId, targetTaskId, queuedSubmissionId, { idempotencyKey: attempt.key });
    if (queueStartAttempt.current === attempt) queueStartAttempt.current = undefined;
    return response;
  };
  const saveQueuedSubmission = async (
    input: AgentPromptInput,
  ): Promise<boolean> => {
    if (taskId === undefined) {
      return false;
    }
    const attempt = resolveIdempotencyAttempt(queueAddAttempt.current,
      JSON.stringify({ projectId, taskId, input }));
    queueAddAttempt.current = attempt;
    // 请求或刷新失败时保留消息身份；Rust 重放同一次入队结果。
    await client.addQueuedSubmission(projectId, taskId, input, attempt.key, {
      idempotencyKey: attempt.key,
    });
    await invalidateQueue();
    if (queueAddAttempt.current === attempt) queueAddAttempt.current = undefined;
    return true;
  };

  const removeQueuedPrompt = async (queuedPromptId: string) => {
    if (taskId === undefined) {
      return;
    }
    await client.deleteQueuedSubmission(projectId, taskId, queuedPromptId, {
      idempotencyKey: createUuid(),
    });
    await invalidateQueue();
  };

  const editQueuedPrompt = async (queuedPrompt: QueuedComposerPrompt) => {
    const editablePrompt = resolveQueuedPromptEdit(queuedPrompt);
    if (
      editablePrompt === undefined ||
      taskId === undefined ||
      queuedPrompt.status !== "queued"
    ) {
      return;
    }
    const content = createPromptSkillContentFromSubmission(
      editablePrompt.text,
      editablePrompt.skills,
    );
    // 先撤回服务端排队项，确保旧附件不再与编辑中的草稿共享生命周期。
    await removeQueuedPrompt(queuedPrompt.id);
    replacePromptContent(content, serializePromptSkillContent(content).length);
    handleAttachmentsChange(editablePrompt.files);
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(serializePromptSkillContent(content).length);
    });
  };

  const onSteerAccepted = (accepted: AcceptedSteerPrompt) => {
    setAwaitingSteers((current) => {
      const prompts = current
        .filter((entry) => entry.scope === routeScope)
        .map((entry) => entry.prompt);
      const retained = retainAcceptedSteerPrompt(prompts, accepted, createUuid);
      return [
        ...current.filter((entry) => entry.scope !== routeScope),
        ...retained.map((prompt) => ({ prompt, scope: routeScope })),
      ];
    });
  };

  const sendQueuedPrompt = async (
    queuedPrompt: QueuedComposerPrompt,
    submitPrompt: SubmitPrompt,
  ) => {
    if (
      queuedPrompt.status !== "queued" ||
      taskId === undefined
    ) {
      return;
    }
    if (activeTurnId !== undefined) {
      const sent = await submitPrompt(
        { files: queuedPrompt.files, text: queuedPrompt.text },
        queuedPrompt.skills,
        {
          clearInputOnSuccess: false,
          forceAction: "steer",
          queuedPromptId: queuedPrompt.id,
          requestTimelineScroll: false,
        },
      );
      if (!sent) {
        return;
      }
      // 原生端已完成追加及清理，界面只重新读取队列。
      await invalidateQueue();
      return;
    }
    const response = await startQueued(taskId, queuedPrompt.id);
    if ("cleanupOnly" in response) {
      await invalidateQueue();
      return;
    }
    onSteerAccepted({
      files: queuedPrompt.files,
      id: queuedPrompt.id,
      skills: queuedPrompt.skills,
      text: queuedPrompt.text,
      turnId: response.turn.id,
      userMessageIds: [],
    });
    await invalidateQueue();
  };

  const moveQueuedPrompt = async (queuedPromptId: string, offset: -1 | 1) => {
    if (taskId === undefined) {
      return;
    }
    // 顺序和边界由 Rust 按当前队列判定；失败后也刷新，避免继续操作过期列表。
    try {
      await client.moveQueuedSubmission(projectId, taskId, queuedPromptId, offset);
    } finally {
      await invalidateQueue();
    }
  };

  return {
    editQueuedPrompt,
    moveQueuedPrompt,
    onSteerAccepted,
    queueError: queueQuery.error,
    queuedPrompts,
    removeQueuedPrompt,
    saveQueuedSubmission,
    sendQueuedPrompt,
  } as const;
}
