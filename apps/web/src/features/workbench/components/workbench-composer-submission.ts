import type {
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
} from "@codexly/protocol";
import type { RefObject } from "react";
import { v4 as createUuid } from "uuid";

import type { PromptInputMessage } from "../../../shared/components/agent/prompt-input.js";
import type { CodexlyMutationClient } from "../../projects/project-queries.js";
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
  createHostedPromptAttachments,
  createComposerTurnOptions,
  resolvePromptAttachment,
  type ComposerMode,
  type WorkbenchComposerProps,
} from "./workbench-composer-contracts.js";

type ComposerSubmissionOptions = Readonly<{
  acp?: WorkbenchComposerProps["acp"];
  activeUserMessageIds: readonly string[];
  activeSettings: AgentTaskSettings | undefined;
  activeTaskId: string | undefined;
  activeTurnId: string | undefined;
  canSteer: boolean;
  canSubmit: boolean;
  clearComposerInput: () => void;
  restoreComposerInput?: (content: PromptSkillContent, files: PromptInputMessage["files"]) => void;
  client: CodexlyMutationClient;
  controller: ReturnType<typeof useWorkbenchComposerController>;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  editingQueuedSubmission: boolean;
  fastMode: boolean;
  onDirectSubmission: WorkbenchComposerProps["onDirectSubmission"];
  onSubmissionFailed?: WorkbenchComposerProps["onSubmissionFailed"];
  onCaptureSubmission?: WorkbenchComposerProps["onCaptureSubmission"];
  onRequestNotificationPermission: () => void;
  onTaskCreated: WorkbenchComposerProps["onTaskCreated"];
  onTaskStarted: WorkbenchComposerProps["onTaskStarted"];
  onTurnStarted: WorkbenchComposerProps["onTurnStarted"];
  pendingTask: AgentTask | undefined;
  composerMode: ComposerMode | undefined;
  onGoalStarted: () => void;
  onSteerAccepted: (prompt: AcceptedSteerPrompt) => void;
  projectId: string;
  workspacePath?: string | undefined;
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
  acp,
  activeUserMessageIds,
  activeSettings,
  activeTaskId,
  activeTurnId,
  canSteer,
  canSubmit,
  clearComposerInput,
  restoreComposerInput,
  client,
  controller,
  followUpBehavior,
  editingQueuedSubmission,
  fastMode,
  onDirectSubmission,
  onSubmissionFailed,
  onCaptureSubmission,
  onRequestNotificationPermission,
  onTaskCreated,
  onTaskStarted,
  onTurnStarted,
  pendingTask,
  composerMode,
  onGoalStarted,
  onSteerAccepted,
  projectId,
  workspacePath,
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
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> => {
    const requestScope = routeScope;
    const captureMode = onCaptureSubmission !== undefined || acp?.capture !== undefined;
    // 直接提交读取编辑器实时快照，避免 React 隐藏字段尚未提交时丢失 Windows 换行。
    const livePromptContent =
      promptSkills === undefined
        ? (skillEditorRef.current?.getContent() ?? promptContent)
        : promptContent;
    const livePromptSubmission =
      promptSkills === undefined ? toPromptSkillSubmission(livePromptContent) : undefined;
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
    if (requestedComposerMode === "goal" && (message.files.length > 0 || skills.length > 0)) {
      setMutationError(new Error(t("composer.goalStructuredInputUnsupported")));
      return false;
    }
    const hasInput = text !== "" || message.files.length > 0 || skills.length > 0;
    // 编辑中的排队项始终更新原记录，不能因 Turn 已结束而误开新 Turn。
    const action =
      options.forceAction ??
      (editingQueuedSubmission
        ? "queue"
        : resolveComposerSubmitAction(state, hasInput, followUpBehavior, canSteer));
    if (
      action === "blocked" ||
      action === "interrupt" ||
      !hasInput ||
      (acp ? acp.isBusy : selectedModel === undefined || selectedReasoningEffort === undefined) ||
      turnControlsDisabled ||
      (!captureMode && action !== "steer" && !canSubmit) ||
      (action === "steer" &&
        (!canSteer || activeTaskId === undefined || activeTurnId === undefined))
    ) {
      return false;
    }

    const continuation = acp?.confirmContinuation;
    if (
      continuation &&
      (action !== "start" || !(await continuation()) || !isCurrentScope(requestScope))
    )
      return false;

    // 排队项由调用方关闭置底请求，只有用户当前发出的即时消息改变阅读位置。
    if (
      !continuation &&
      !captureMode &&
      action !== "queue" &&
      options.requestTimelineScroll !== false
    ) {
      onDirectSubmission?.(
        action === "start" && options.clearInputOnSuccess !== false
          ? { files: message.files, skills, text }
          : undefined,
      );
    }
    // 捕获模式只保存配置，不应为尚未运行的任务申请通知权限。
    if (!captureMode) onRequestNotificationPermission();
    setIsSubmitting(true);
    setMutationError(null);
    const clearedForStart =
      action === "start" && !captureMode && options.clearInputOnSuccess !== false;
    if (clearedForStart && isCurrentScope(requestScope)) clearComposerInput();
    const rejectPreview = () => {
      onSubmissionFailed?.();
      if (clearedForStart) restoreComposerInput?.(livePromptContent, message.files);
    };
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
        if (action === "start") rejectPreview();
        setMutationError(
          error instanceof Error ? error : new Error(t("composer.attachmentUploadFailed")),
        );
        setIsSubmitting(false);
      }
      return false;
    }

    // ACP 直接发送原生会话配置；旧路径等待完整设置，不能补造权限。
    const turnOptions =
      acp || activeSettings === undefined
        ? undefined
        : createComposerTurnOptions(
            activeSettings,
            selectedModel?.id ?? activeSettings.model,
            selectedReasoningEffort,
            requestedComposerMode,
            fastMode,
          );
    if (captureMode) {
      try {
        // 定时任务只捕获 ACP 配置和已上传附件，交给计划编辑事务保存。
        if (acp?.capture) await acp.capture(input, messageAttachments);
        else if (turnOptions && onCaptureSubmission)
          await onCaptureSubmission(input, turnOptions, messageAttachments);
        else return false;
        return true;
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Prompt capture failed"));
        }
        return false;
      } finally {
        if (isCurrentScope(requestScope)) setIsSubmitting(false);
      }
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
          const hostedFiles = createHostedPromptAttachments(
            projectId,
            activeTaskId,
            messageAttachments,
          );
          onSteerAccepted({
            files: hostedFiles,
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

    const turnAttempt = resolveIdempotencyAttempt(
      startTurnAttempt.current,
      JSON.stringify({
        projectId,
        workspacePath,
        taskId: activeTaskId,
        input,
        options: turnOptions,
        acpConfig: acp?.configurationIntent,
      }),
    );
    startTurnAttempt.current = turnAttempt;
    try {
      const result:
        Awaited<ReturnType<NonNullable<WorkbenchComposerProps["acp"]>["submit"]>> | undefined = acp
        ? await acp.submit(input, turnAttempt.key)
        : turnOptions === undefined
          ? undefined
          : await startPromptTurn(client, {
              idempotencyKey: turnAttempt.key,
              input,
              onTaskCreated(task) {
                // 后端完成创建与启动后发布 Task，浏览器只更新当前页面。
                if (isCurrentScope(requestScope)) {
                  setPendingTaskState({ scope: requestScope, task });
                  onTaskCreated?.(task);
                }
              },
              projectId,
              ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
              turnOptions,
              ...(activeTaskId === undefined && workspacePath ? { workspacePath } : {}),
            });
      if (result === undefined) return false;
      if (isCurrentScope(requestScope)) {
        if (turnOptions?.goalMode === true) {
          // Goal 已写入 Codex Thread，后续消息必须恢复为普通提交，避免替换目标。
          onGoalStarted();
        }
        if (!continuation) setSubmittedTurnState({ scope: requestScope, turnId: result.turn.id });
      }
      // Mutation 返回后立即上报本次提交，Timeline 不等待 Provider Snapshot 落盘。
      if (!continuation) onTurnStarted?.(result.turn, input, messageAttachments);
      if (isCurrentScope(requestScope)) {
        startTurnAttempt.current = undefined;
        uploadedAttachments.current.clear();
        uploadAttempts.current.clear();
      }
      if (taskId === undefined || (continuation && isCurrentScope(requestScope))) {
        const startedTask = result.createdTask ?? pendingTask;
        if (startedTask !== undefined) {
          onTaskStarted(
            startedTask,
            result.turn,
            input,
            turnOptions,
            messageAttachments,
            result.checkpoint,
            ...(result.acpSnapshot ? ([result.acpSnapshot] as const) : ([] as const)),
          );
        }
      }
      return true;
    } catch (error) {
      if (isCurrentScope(requestScope)) {
        rejectPreview();
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
      requestTimelineScroll?: boolean;
    }> = {},
  ): Promise<boolean> =>
    composerActionLock
      .run(() => performPromptSubmission(message, promptSkills, options))
      .then((submitted) => submitted ?? false);
  return submitPrompt;
}
