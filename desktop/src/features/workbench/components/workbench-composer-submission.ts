import type {
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
} from "@/protocol/index.js";
import type { RefObject } from "react";
import { v4 as createUuid } from "uuid";

import { NativeCommandError } from "../../../platform/tauri/native-client.js";
import type { PromptInputMessage } from "../../../shared/components/agent/prompt-input.js";
import type { NativeMutationClient } from "../../projects/project-queries.js";
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
  client: NativeMutationClient;
  controller: ReturnType<typeof useWorkbenchComposerController>;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  fastMode: boolean;
  isCurrentSubmissionTarget: (projectId: string, taskId: string) => boolean;
  onDirectSubmission: WorkbenchComposerProps["onDirectSubmission"];
  onCaptureSubmission: WorkbenchComposerProps["onCaptureSubmission"];
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
  saveQueuedSubmission: (input: AgentPromptInput) => Promise<boolean>;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
  state: ComposerState;
  taskId: string | undefined;
  t: (key: string) => string;
  turnControlsDisabled: boolean;
}>;

export function toPromptSubmissionError(
  error: unknown,
  t: (key: string) => string,
): Error {
  // 仅按原生错误码选择展示文案，业务校验统一由 Rust 执行。
  if (error instanceof NativeCommandError) {
    const key = ({
      CODEX_THREAD_BUSY: "composer.threadBusy",
      GOAL_OBJECTIVE_REQUIRED: "composer.goalObjectiveRequired",
      GOAL_OBJECTIVE_TOO_LONG: "composer.goalObjectiveTooLong",
      GOAL_STRUCTURED_INPUT_UNSUPPORTED: "composer.goalStructuredInputUnsupported",
    } as Readonly<Record<string, string>>)[error.code];
    if (key !== undefined) return new NativeCommandError(error.code, t(key), error.rpcCode);
  }
  return error instanceof Error ? error : new Error(t("composer.operationFailed"));
}

type AttachmentModalityInput = Readonly<{
  kind: string;
  mediaType: string;
  name: string;
}>;

export function findUnsupportedInputModality(
  attachments: readonly AttachmentModalityInput[],
  inputModalities: readonly string[],
): "audio" | "image" | undefined {
  for (const attachment of attachments) {
    if (attachment.kind === "image" && !inputModalities.includes("image")) {
      return "image";
    }
    const isAudio =
      attachment.mediaType.startsWith("audio/") ||
      /\.(?:m4a|mp3|ogg|wav|webm)$/iu.test(attachment.name);
    if (isAudio && !inputModalities.includes("audio")) {
      return "audio";
    }
  }
  return undefined;
}

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
  isCurrentSubmissionTarget,
  onDirectSubmission,
  onCaptureSubmission,
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
    attachmentUploadPromises,
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
    const skills = promptSkills ?? livePromptSubmission?.skills ?? [];
    const unsupportedModality =
      selectedModel === undefined
        ? undefined
        : findUnsupportedInputModality(message.files, selectedModel.inputModalities);
    if (unsupportedModality !== undefined) {
      setMutationError(
        new Error(
          t(
            unsupportedModality === "image"
              ? "composer.modelImageInputUnsupported"
              : "composer.modelAudioInputUnsupported",
          ),
        ),
      );
      return false;
    }
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
      (onCaptureSubmission === undefined && action !== "steer" && !canSubmit) ||
      (action === "steer" &&
        (!canSteer || activeTaskId === undefined || activeTurnId === undefined))
    ) {
      return false;
    }

    // 排队项由调用方关闭置底请求，只有用户当前发出的即时消息改变阅读位置。
    if (
      onCaptureSubmission === undefined &&
      action !== "queue" &&
      options.requestTimelineScroll !== false
    ) {
      onDirectSubmission?.();
    }
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
            const pendingUpload = attachmentUploadPromises.current.get(browserAttachment.id);
            if (pendingUpload !== undefined) return pendingUpload;
            const idempotencyKey = uploadAttempts.current.get(browserAttachment.id) ?? createUuid();
            uploadAttempts.current.set(browserAttachment.id, idempotencyKey);
            const uploadPromise = client
              .uploadAttachment(
                projectId,
                {
                  content: browserAttachment.file,
                  kind: browserAttachment.kind,
                  name: browserAttachment.name,
                },
                { idempotencyKey },
              )
              .then((response) => {
                if (isCurrentScope(requestScope)) {
                  uploadedAttachments.current.set(browserAttachment.id, response.attachment);
                }
                return response.attachment;
              });
            attachmentUploadPromises.current.set(browserAttachment.id, uploadPromise);
            try {
              return await uploadPromise;
            } finally {
              if (attachmentUploadPromises.current.get(browserAttachment.id) === uploadPromise) {
                attachmentUploadPromises.current.delete(browserAttachment.id);
              }
            }
          }),
        ),
      );
      input = {
        attachments: [...messageAttachments],
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

    const turnOptions = createComposerTurnOptions(
      activeSettings,
      selectedModel.id,
      selectedReasoningEffort,
      requestedComposerMode,
      fastMode,
    );
    if (onCaptureSubmission !== undefined) {
      try {
        await onCaptureSubmission(input, turnOptions, messageAttachments);
        return true;
      } catch (error) {
        if (isCurrentScope(requestScope)) setMutationError(toPromptSubmissionError(error, t));
        return false;
      } finally {
        if (isCurrentScope(requestScope)) setIsSubmitting(false);
      }
    }

    if (action === "queue") {
      try {
        const saved = await saveQueuedSubmission(input);
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
        JSON.stringify({ input, taskId: activeTaskId, turnId: activeTurnId, queuedPromptId: options.queuedPromptId }),
      );
      steerTurnAttempt.current = steerAttempt;
      try {
        const response = await steerPromptTurn(
          client,
          projectId,
          activeTaskId,
          activeTurnId,
          input,
          steerAttempt.key,
          options.queuedPromptId,
        );
        const isCurrentScopeAfterSteer = isCurrentScope(requestScope);
        const isCurrentTargetAfterSteer = isCurrentSubmissionTarget(projectId, activeTaskId);
        // 清理重放没有产生新输入，不能把旧消息再次挂到当前回合。
        if (isCurrentScopeAfterSteer && response.cleanupOnly !== true) {
          onSteerAccepted({
            files: message.files,
            ...(options.queuedPromptId === undefined ? {} : { id: options.queuedPromptId }),
            skills,
            text,
            turnId: activeTurnId,
            userMessageIds: activeUserMessageIds,
          });
        }
        // pendingTask 切换为真实 taskId 会改变 routeScope，但仍应清空同一 Task 的已发送输入。
        if (isCurrentTargetAfterSteer && options.clearInputOnSuccess !== false) {
          clearComposerInput();
        }
        if (isCurrentScopeAfterSteer) {
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
          onTaskStarted(
            startedTask,
            result.turn,
            input,
            turnOptions,
            messageAttachments,
            result.checkpoint,
          );
        }
      }
      return true;
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        setMutationError(toPromptSubmissionError(error, t));
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
