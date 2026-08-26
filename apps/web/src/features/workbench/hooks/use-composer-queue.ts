import type { AgentPromptInput, AgentQueuedSubmission, AgentSkill } from "@codexly/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { v4 as createUuid } from "uuid";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { taskQueueQueryKey, type CodexlyMutationClient } from "../../projects/project-queries.js";
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
  client: CodexlyMutationClient;
  handleAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  projectId: string;
  replacePromptContent: (content: PromptSkillContent, cursorOffset?: number) => void;
  routeScope: string;
  runtime: TaskRuntimeView | undefined;
  skillEditorRef: { current: PromptSkillEditorHandle | null };
  skills: readonly AgentSkill[];
  taskId: string | undefined;
}>;

async function listAllQueuedSubmissions(
  client: CodexlyMutationClient,
  projectId: string,
  taskId: string,
  signal: AbortSignal,
): Promise<readonly AgentQueuedSubmission[]> {
  const submissions: AgentQueuedSubmission[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listQueuedSubmissions(
      projectId,
      taskId,
      { ...(cursor === undefined ? {} : { cursor }), limit: 100 },
      { signal },
    );
    submissions.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return submissions;
}

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
  const queryKey = taskQueueQueryKey(projectId, taskId ?? "");
  const queueQuery = useQuery({
    enabled: taskId !== undefined,
    queryFn: ({ signal }) => listAllQueuedSubmissions(client, projectId, taskId ?? "", signal),
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
  const editingPrompt = serverPrompts.find((prompt) => prompt.status === "editing");
  const editingId = editingPrompt?.id;
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
  const saveQueuedSubmission = async (
    input: AgentPromptInput,
    clientUserMessageId: string,
  ): Promise<boolean> => {
    if (taskId === undefined) {
      return false;
    }
    if (editingId === undefined) {
      await client.addQueuedSubmission(projectId, taskId, input, clientUserMessageId, {
        idempotencyKey: createUuid(),
      });
    } else {
      await client.updateQueuedSubmission(projectId, taskId, editingId, input, "queued", {
        idempotencyKey: createUuid(),
      });
      if (activeTurnId === undefined) {
        await client.startQueuedSubmission(projectId, taskId, editingId, {
          idempotencyKey: createUuid(),
        });
      }
    }
    await invalidateQueue();
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
    if (editablePrompt === undefined) {
      return;
    }
    const content = createPromptSkillContentFromSubmission(
      editablePrompt.text,
      editablePrompt.skills,
    );
    if (taskId === undefined || queuedPrompt.status !== "queued") {
      return;
    }
    const updateRequest = client.updateQueuedSubmission(
      projectId,
      taskId,
      queuedPrompt.id,
      {
        attachments: editablePrompt.files.flatMap((file) =>
          file.source === "host" ? [{ id: file.attachment.id }] : [],
        ),
        skills: editablePrompt.skills.map(({ id, name }) => ({ id, name })),
        text: editablePrompt.text,
        type: "prompt",
      },
      "editing",
      { idempotencyKey: createUuid() },
    );
    // 首次 await 前同步回填，禁止慢请求在用户开始输入后用旧内容覆盖草稿。
    replacePromptContent(content, serializePromptSkillContent(content).length);
    handleAttachmentsChange(editablePrompt.files);
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(serializePromptSkillContent(content).length);
    });
    await updateRequest;
    await invalidateQueue();
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
    const promptIndex = serverPrompts.findIndex((prompt) => prompt.id === queuedPrompt.id);
    const editingIndex = serverPrompts.findIndex((prompt) => prompt.status === "editing");
    if (
      queuedPrompt.status !== "queued" ||
      taskId === undefined ||
      (editingIndex >= 0 && promptIndex >= editingIndex)
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
      await removeQueuedPrompt(queuedPrompt.id);
      return;
    }
    const response = await client.startQueuedSubmission(projectId, taskId, queuedPrompt.id, {
      idempotencyKey: createUuid(),
    });
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
    const ids = serverPrompts.map((prompt) => prompt.id);
    const index = ids.indexOf(queuedPromptId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    const currentId = ids[index];
    const targetId = ids[target];
    if (currentId === undefined || targetId === undefined) {
      return;
    }
    ids[index] = targetId;
    ids[target] = currentId;
    await client.reorderQueuedSubmissions(projectId, taskId, ids, {
      idempotencyKey: createUuid(),
    });
    await invalidateQueue();
  };

  return {
    editQueuedPrompt,
    editingId,
    moveQueuedPrompt,
    onSteerAccepted,
    queueError: queueQuery.error,
    queuedPrompts,
    removeQueuedPrompt,
    saveQueuedSubmission,
    sendQueuedPrompt,
  } as const;
}
