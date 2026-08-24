import type {
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
} from "@code-agent/protocol";
import type { RefObject } from "react";
import { v4 as createUuid } from "uuid";

import type { PromptInputMessage } from "../../../shared/components/agent/prompt-input.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import type { AcceptedSteerPrompt } from "../composer-queue-state.js";
import {
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
  startPromptTurn,
  steerPromptTurn,
  type ComposerState,
} from "../composer-state.js";
import type { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import {
  toPromptSkillSubmission,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";
import {
  createComposerTurnOptions,
  resolvePromptAttachment,
  type ComposerMode,
  type WorkbenchComposerProps,
} from "./workbench-composer-contracts.js";

type ComposerSubmissionOptions = Readonly<{
  activeUserMessageIds: readonly string[];
  activeSettings: AgentTaskSettings;
  activeTaskId: string | undefined;
  activeTurnId: string | undefined;
  canSteer: boolean;
  canSubmit: boolean;
  clearComposerInput: () => void;
  client: CodeAgentMutationClient;
  controller: ReturnType<typeof useWorkbenchComposerController>;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  fastMode: boolean;
  onDirectSubmission: WorkbenchComposerProps["onDirectSubmission"];
  onRequestNotificationPermission: () => void;
  onTaskCreated: WorkbenchComposerProps["onTaskCreated"];
  onTaskStarted: WorkbenchComposerProps["onTaskStarted"];
  onTurnStarted: WorkbenchComposerProps["onTurnStarted"];
  pendingTask: AgentTask | undefined;
  composerMode: ComposerMode | undefined;
  onGoalStarted: () => void;
  onSteerAccepted: (prompt: AcceptedSteerPrompt) => void;
  projectId: string;
  promptContent: PromptSkillContent;
  routeScope: string;
  saveQueuedSubmission: (input: AgentPromptInput, clientUserMessageId: string) => Promise<boolean>;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
  state: ComposerState;
  taskId: string | undefined;
  t: (key: string) => string;
  turnControlsDisabled: boolean;
}>;

export function createComposerSubmission({
  activeUserMessageIds,
  activeSettings,
  activeTaskId,
  activeTurnId,
  canSteer,
  canSubmit,
  clearComposerInput,
  client,
  controller,
  followUpBehavior,
  fastMode,
  onDirectSubmission,
  onRequestNotificationPermission,
  onTaskCreated,
  onTaskStarted,
  onTurnStarted,
  pendingTask,
  composerMode,
  onGoalStarted,
  onSteerAccepted,
  projectId,
  promptContent,
  routeScope,
  saveQueuedSubmission,
  selectedModel,
  selectedReasoningEffort,
  skillEditorRef,
  state,
  taskId,
  t,
  turnControlsDisabled,
}: ComposerSubmissionOptions) {
  const {
    actionLock: composerActionLock,
    isCurrentScope,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTaskAttempt,
    startTurnAttempt,
    steerTurnAttempt,
    uploadAttempts,
    uploadedAttachments,
  } = controller;
  const performPromptSubmission = async (
    message: PromptInputMessage,
    promptSkills?: readonly AgentSkill[],
    options: Readonly<{
      clearInputOnSuccess?: boolean;
      forceAction?: "start" | "steer";
      composerMode?: ComposerMode | null;
      queuedPromptId?: string;
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> => {
    const requestScope = routeScope;
    // 直接提交读取编辑器实时快照，避免 React 隐藏字段尚未提交时丢失 Windows 换行。
    const livePromptSubmission =
      promptSkills === undefined
        ? toPromptSkillSubmission(skillEditorRef.current?.getContent() ?? promptContent)
        : undefined;
    const text = (livePromptSubmission?.text ?? message.text).trim();
    const requestedComposerMode =
      options.composerMode === null ? undefined : (options.composerMode ?? composerMode);
    if (requestedComposerMode === "goal" && (text.length === 0 || text.length > 4_000)) {
      setMutationError(
        new Error(
          t(text.length === 0 ? "composer.goalObjectiveRequired" : "composer.goalObjectiveTooLong"),
        ),
      );
      return false;
    }
    const skills = promptSkills ?? livePromptSubmission?.skills ?? [];
    const hasInput = text !== "" || message.files.length > 0 || skills.length > 0;
    const action =
      options.forceAction ??
      resolveComposerSubmitAction(state, hasInput, followUpBehavior, canSteer);
    if (
      action === "blocked" ||
      action === "interrupt" ||
      !hasInput ||
      selectedModel === undefined ||
      selectedReasoningEffort === undefined ||
      turnControlsDisabled ||
      (action !== "steer" && !canSubmit) ||
      (action === "steer" &&
        (!canSteer || activeTaskId === undefined || activeTurnId === undefined))
    ) {
      return false;
    }

    // 排队项由调用方关闭置底请求，只有用户当前发出的即时消息改变阅读位置。
    if (action !== "queue" && options.requestTimelineScroll !== false) {
      onDirectSubmission?.();
    }
    // Notification 权限必须在提交手势内申请，不能等网络 Mutation 完成后再触发。
    onRequestNotificationPermission();
    setIsSubmitting(true);
    setMutationError(null);
    let input: AgentPromptInput;
    let messageAttachments: readonly AgentMessageAttachment[];
    try {
      messageAttachments = await Promise.all(
        message.files.map((attachment) =>
          resolvePromptAttachment(attachment, async (browserAttachment) => {
            const uploaded = uploadedAttachments.current.get(browserAttachment.id);
            if (uploaded !== undefined) {
              return uploaded;
            }
            const idempotencyKey = uploadAttempts.current.get(browserAttachment.id) ?? createUuid();
            uploadAttempts.current.set(browserAttachment.id, idempotencyKey);
            const response = await client.uploadAttachment(
              projectId,
              {
                content: browserAttachment.file,
                kind: browserAttachment.kind,
                name: browserAttachment.name,
              },
              { idempotencyKey },
            );
            if (isCurrentScope(requestScope)) {
              uploadedAttachments.current.set(browserAttachment.id, response.attachment);
            }
            return response.attachment;
          }),
        ),
      );
      input = {
        attachments: messageAttachments.map((attachment) => ({ id: attachment.id })),
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name })),
        text,
        type: "prompt",
      };
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        setMutationError(
          error instanceof Error ? error : new Error(t("composer.attachmentUploadFailed")),
        );
        setIsSubmitting(false);
      }
      return false;
    }

    if (action === "queue") {
      try {
        const saved = await saveQueuedSubmission(input, createUuid());
        if (saved && isCurrentScope(requestScope)) {
          clearComposerInput();
          uploadedAttachments.current.clear();
          uploadAttempts.current.clear();
        }
        return saved;
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Prompt queueing failed"));
        }
        return false;
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    }

    if (action === "steer") {
      if (activeTaskId === undefined || activeTurnId === undefined) {
        return false;
      }
      const steerAttempt = resolveIdempotencyAttempt(
        steerTurnAttempt.current,
        JSON.stringify({ input, taskId: activeTaskId, turnId: activeTurnId }),
      );
      steerTurnAttempt.current = steerAttempt;
      try {
        await steerPromptTurn(
          client,
          projectId,
          activeTaskId,
          activeTurnId,
          input,
          steerAttempt.key,
        );
        if (isCurrentScope(requestScope)) {
          onSteerAccepted({
            files: message.files,
            ...(options.queuedPromptId === undefined ? {} : { id: options.queuedPromptId }),
            skills,
            text,
            turnId: activeTurnId,
            userMessageIds: activeUserMessageIds,
          });
          if (options.clearInputOnSuccess !== false) {
            clearComposerInput();
          }
          steerTurnAttempt.current = undefined;
          uploadedAttachments.current.clear();
          uploadAttempts.current.clear();
        }
        return true;
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Prompt steering failed"));
        }
        return false;
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    }

    const turnOptions = createComposerTurnOptions(
      activeSettings,
      selectedModel.id,
      selectedReasoningEffort,
      requestedComposerMode,
      fastMode,
    );
    const turnAttempt = resolveIdempotencyAttempt(
      startTurnAttempt.current,
      JSON.stringify({ input, options: turnOptions }),
    );
    startTurnAttempt.current = turnAttempt;
    const taskAttempt =
      activeTaskId === undefined
        ? resolveIdempotencyAttempt(startTaskAttempt.current, projectId)
        : undefined;
    startTaskAttempt.current = taskAttempt;
    try {
      const result = await startPromptTurn(client, {
        idempotencyKeys: {
          ...(taskAttempt === undefined ? {} : { startTask: taskAttempt.key }),
          startTurn: turnAttempt.key,
        },
        input,
        onTaskCreated(task) {
          // Turn 启动失败时保留已创建 Task，重试不能重复创建。
          if (isCurrentScope(requestScope)) {
            setPendingTaskState({ scope: requestScope, task });
            startTaskAttempt.current = undefined;
            // 真实 taskId 可用后立即交给工作台缓存并选中，不等待 turn/start。
            onTaskCreated?.(task);
          }
        },
        projectId,
        ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        turnOptions,
      });
      if (isCurrentScope(requestScope)) {
        if (options.clearInputOnSuccess !== false) {
          clearComposerInput();
        }
        if (turnOptions.goalMode === true) {
          // Goal 已写入 Codex Thread，后续消息必须恢复为普通提交，避免替换目标。
          onGoalStarted();
        }
        setSubmittedTurnState({ scope: requestScope, turnId: result.turn.id });
      }
      // Mutation 返回后立即上报本次提交，Timeline 不等待 Provider Snapshot 落盘。
      onTurnStarted?.(result.turn, input, messageAttachments);
      if (isCurrentScope(requestScope)) {
        startTurnAttempt.current = undefined;
        uploadedAttachments.current.clear();
        uploadAttempts.current.clear();
      }
      if (taskId === undefined) {
        const startedTask = result.createdTask ?? pendingTask;
        if (startedTask !== undefined) {
          onTaskStarted(startedTask, result.turn, input, turnOptions, messageAttachments);
        }
      }
      return true;
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        setMutationError(error instanceof Error ? error : new Error("Prompt submission failed"));
      }
      return false;
    } finally {
      if (isCurrentScope(requestScope)) {
        setIsSubmitting(false);
      }
    }
  };

  const submitPrompt = (
    message: PromptInputMessage,
    promptSkills?: readonly AgentSkill[],
    options: Readonly<{
      clearInputOnSuccess?: boolean;
      forceAction?: "start" | "steer";
      composerMode?: ComposerMode | null;
      queuedPromptId?: string;
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> =>
    composerActionLock
      .run(() => performPromptSubmission(message, promptSkills, options))
      .then((submitted) => submitted ?? false);
  return submitPrompt;
}
