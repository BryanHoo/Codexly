import type { AgentTaskSettings } from "@codexly/protocol";
import { useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { getTaskStoreUserMessageIds } from "../composer-queue-state.js";
import {
  interruptPromptTurn,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
} from "../composer-state.js";
import { isPromptSkillContentEmpty } from "./prompt-skill-editor.js";
import { useWorkbenchBranchSwitch } from "../hooks/use-workbench-branch-switch.js";
import { useComposerQueue } from "../hooks/use-composer-queue.js";
import { useProjectTodoEditing } from "../hooks/use-project-todo-editing.js";
import { createComposerCommands } from "./workbench-composer-commands.js";
import { createProjectTodoComposerActions } from "./project-todo-composer-actions.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import { useComposerSession } from "./workbench-composer-session.js";
import { createComposerSubmission } from "./workbench-composer-submission.js";
import { WorkbenchComposerAttachmentPicker } from "./workbench-composer-attachment-picker.js";
import { WorkbenchComposerView } from "./workbench-composer-view.js";
export * from "./workbench-composer-contracts.js";
export * from "../composer-state.js";
export function WorkbenchComposer({
  composerRef,
  capabilities,
  captureSubmitVisible = true,
  client,
  composerDraftId,
  fastModeAvailable,
  fastModeDefault,
  followUpBehavior,
  footerVisible = true,
  initialDraft,
  initialTodoId,
  models,
  modelsError,
  modelsPending,
  onDirectSubmission,
  onCaptureSubmission,
  onFastModeChange,
  onInputStateChange,
  onOpenProjectPath,
  onProjectRootChange,
  onRequestNotificationPermission,
  onSettingsChange,
  onSubmissionStateChange,
  onTaskCreated,
  onTaskStarted,
  onTurnStarted,
  projectId,
  projectName,
  projectPath,
  projectPathOpenDisabled,
  projectRoots,
  projectToolsEnabled = true,
  selectedProjectRootId,
  gitStatus,
  runtime,
  settings,
  skills,
  taskId,
}: WorkbenchComposerProps) {
  const { t } = useTranslation(["workbench", "settings"]);
  const todoEditing = useProjectTodoEditing(projectId, initialTodoId);
  const { editingTodoId, projectTodos, todos } = todoEditing;
  const session = useComposerSession({
    capabilities,
    composerDraftId,
    client,
    editingTodoId,
    gitStatus,
    models,
    initialDraft,
    onSubmissionStateChange,
    projectId,
    projectPath,
    projectToolsEnabled,
    projectTodos,
    runtime,
    settings,
    skills,
    taskId,
  });
  const {
    activeCommandIndex,
    activeCommandItemId,
    activeSettings,
    activeTaskId,
    activeTurnId,
    attachmentCount,
    attachmentPickerKind,
    attachments,
    attachmentsDisabled,
    baseBranches,
    canInterrupt,
    canSteer,
    canSubmit,
    clearComposerInput,
    closeCommandMenu,
    closeFileMenu,
    commandMenuId,
    commandMenuOpen,
    commandSurfaceRef,
    composerMode,
    composerController,
    composerScope,
    contextUsage,
    draftInputDisabled,
    filteredCommands,
    filteredSkills,
    fileMenuOpen,
    fileSearchError,
    fileSearchPending,
    fileSearchResults,
    handleAttachmentsChange,
    handlePromptChange,
    isSubmitting,
    menuItemCount,
    navigatePromptHistory,
    pendingTask,
    promptContent,
    promptSubmission,
    referenceProjectPath,
    reviewMenuMode,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    selectFileReference,
    setActiveCommandIndex,
    setAttachmentPickerKind,
    setIsSubmitting,
    setMutationError,
    setComposerModeState,
    setReviewMenuMode,
    setSettingsOverride,
    skillEditorRef,
    state,
    turnControlsDisabled,
  } = session;
  const [fastModeSelection, setFastModeSelection] =
    useState<Readonly<{ enabled: boolean; scope: string }>>();
  const fastModeSelected =
    fastModeSelection?.scope === composerScope ? fastModeSelection.enabled : fastModeDefault;
  const fastModeEnabled = fastModeAvailable && fastModeSelected;
  const {
    actionLock: composerActionLock,
    interruptAttempt,
    isCurrentScope,
    uploadAttempts,
    uploadedAttachments,
  } = composerController;
  const updateSettings = (nextSettings: AgentTaskSettings, field: keyof AgentTaskSettings) => {
    const requestScope = routeScope;
    setSettingsOverride({ scope: requestScope, settings: nextSettings });
    setMutationError(null);
    // 设置写回由用户事件直接触发，避免 effect 重放或并发渲染造成重复请求。
    void Promise.resolve(onSettingsChange(nextSettings, field, fastModeSelected)).catch(
      () => undefined,
    );
  };
  const branchMutation = useWorkbenchBranchSwitch({
    client,
    gitStatus,
    isCurrentScope,
    projectId,
    rootPath: projectPath,
    routeScope,
  });
  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
      closeFileMenu();
    }
  }, [closeCommandMenu, closeFileMenu, turnControlsDisabled]);
  useEffect(() => {
    if (!commandMenuOpen && !fileMenuOpen) {
      return undefined;
    }
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu();
        closeFileMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && !commandSurfaceRef.current?.contains(eventTarget)) {
        // 输入框和命令弹层共享一个交互区域，只有点击区域外部才关闭弹层。
        closeCommandMenu();
        closeFileMenu();
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [closeCommandMenu, closeFileMenu, commandMenuOpen, commandSurfaceRef, fileMenuOpen]);
  const composerQueue = useComposerQueue({
    activeTurnId,
    client,
    handleAttachmentsChange,
    projectId,
    replacePromptContent: session.replacePromptContent,
    routeScope,
    runtime,
    skillEditorRef,
    skills,
    taskId,
  });
  useEffect(() => {
    if (composerQueue.queueError !== null) {
      setMutationError(composerQueue.queueError);
    }
  }, [composerQueue.queueError, setMutationError]);
  const submitPrompt = createComposerSubmission({
    activeUserMessageIds:
      runtime?.store === undefined
        ? []
        : getTaskStoreUserMessageIds(runtime.store.getState(), activeTurnId),
    activeSettings,
    activeTaskId,
    activeTurnId,
    canSteer,
    canSubmit,
    clearComposerInput,
    client,
    controller: composerController,
    composerMode,
    editingQueuedSubmission: composerQueue.editingId !== undefined,
    followUpBehavior,
    fastMode: fastModeEnabled,
    onDirectSubmission,
    onCaptureSubmission,
    onGoalStarted: () => {
      setComposerModeState(undefined);
    },
    onSteerAccepted: composerQueue.onSteerAccepted,
    onRequestNotificationPermission,
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    pendingTask,
    projectId,
    promptContent,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    saveQueuedSubmission: composerQueue.saveQueuedSubmission,
    skillEditorRef,
    state,
    taskId,
    t,
    turnControlsDisabled,
  });
  useImperativeHandle(composerRef, () => ({
    buildPlan: () => {
      setComposerModeState(undefined); // 避免后续 Turn 再次请求生成计划。
      return submitPrompt({ files: [], text: t("composer.buildPlanPrompt") }, [], {
        composerMode: null,
        forceAction: "start",
      });
    },
    referenceProjectPath,
    submitCurrent: () => submitPrompt({ files: attachments, text: promptSubmission.text }),
  }));
  const {
    executePromptCommand,
    executeReviewTarget,
    getCommandAvailability,
    selectActiveCommandItem,
    selectSkill,
  } = createComposerCommands({
    capabilities,
    client,
    onRequestNotificationPermission,
    onTaskCreated,
    onTaskStarted,
    projectId,
    session,
    submitPrompt,
    t,
    taskId,
  });
  const interruptTurn = async () => {
    const requestScope = routeScope;
    if (
      !canInterrupt ||
      activeTaskId === undefined ||
      activeTurnId === undefined ||
      turnControlsDisabled
    ) {
      return;
    }
    await composerActionLock.run(async () => {
      const fingerprint = `${activeTaskId}:${activeTurnId}`;
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(interruptAttempt.current, fingerprint);
      interruptAttempt.current = attempt;
      try {
        // `202` 仅确认请求已接收；后续显式重试继续复用同一幂等键。
        await interruptPromptTurn(client, projectId, activeTaskId, activeTurnId, attempt.key);
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Turn interruption failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });
  };
  const hasComposerInput = !isPromptSkillContentEmpty(promptContent) || attachmentCount > 0;
  useEffect(() => onInputStateChange?.(hasComposerInput), [hasComposerInput, onInputStateChange]);
  const todoActions = createProjectTodoComposerActions({
    actionLock: composerActionLock,
    attachments,
    clearComposerInput,
    client,
    editingTodoId,
    fallbackError: t("composer.saveTodoFailed"),
    hasComposerInput,
    isCurrentScope,
    isSubmitting,
    onEditingComplete: todoEditing.complete,
    projectId,
    projectTodos,
    promptContent,
    routeScope,
    setIsSubmitting,
    setMutationError,
    skillEditorRef,
    submitPrompt,
    uploadAttempts,
    uploadedAttachments,
  });
  const submitAction =
    composerQueue.editingId === undefined
      ? resolveComposerSubmitAction(state, hasComposerInput, followUpBehavior, canSteer)
      : "queue";
  const composerView = (
    <WorkbenchComposerView
      activeCommandIndex={activeCommandIndex}
      activeCommandItemId={activeCommandItemId}
      activeSettings={activeSettings}
      activeTurnId={activeTurnId}
      attachments={attachments}
      attachmentsDisabled={attachmentsDisabled}
      baseBranches={baseBranches}
      canInterrupt={canInterrupt}
      canSteer={canSteer}
      canSubmit={canSubmit}
      captureMode={onCaptureSubmission !== undefined}
      captureSubmitVisible={captureSubmitVisible}
      commandMenuId={commandMenuId}
      commandMenuOpen={commandMenuOpen}
      commandSurfaceRef={commandSurfaceRef}
      composerMode={composerMode}
      composerScope={composerScope}
      contextUsage={contextUsage}
      creatingBranch={branchMutation.creatingBranch}
      creatingWorktree={branchMutation.creatingWorktree}
      draftInputDisabled={draftInputDisabled}
      editingTodoId={editingTodoId}
      filteredCommands={filteredCommands}
      filteredSkills={filteredSkills}
      fileMenuOpen={fileMenuOpen}
      fileSearchError={fileSearchError}
      fileSearchPending={fileSearchPending}
      fileSearchResults={fileSearchResults}
      fastModeAvailable={fastModeAvailable}
      fastModeEnabled={fastModeEnabled}
      footerVisible={footerVisible}
      getCommandAvailability={getCommandAvailability}
      gitStatus={gitStatus}
      goal={runtime?.metadata?.goal}
      hasComposerInput={hasComposerInput}
      isSubmitting={isSubmitting}
      menuItemCount={menuItemCount}
      moveQueuedPrompt={(queuedPromptId, offset) => {
        void composerQueue.moveQueuedPrompt(queuedPromptId, offset).catch(setMutationError);
      }}
      models={models}
      modelsError={modelsError}
      modelsPending={modelsPending}
      editQueuedPrompt={(queuedPrompt) => {
        void composerQueue.editQueuedPrompt(queuedPrompt).catch(setMutationError);
      }}
      onComposerModeRemove={() => {
        setComposerModeState(undefined);
      }}
      onProjectTodoDelete={(todoId) => {
        todoEditing.remove(todoId);
      }}
      onProjectTodoRestore={(todoId) => {
        todoEditing.restore(todoId, clearComposerInput);
      }}
      onProjectTodoSave={() => {
        void todoActions.save();
      }}
      onAttachmentsChange={(files) => {
        handleAttachmentsChange(files);
        todoEditing.discardIfEmpty(files.length > 0 || !isPromptSkillContentEmpty(promptContent));
      }}
      onBranchCreate={branchMutation.createBranch}
      onBranchChange={(branch) => {
        void branchMutation.switchBranch(branch);
      }}
      onWorktreeChange={(path) => {
        void branchMutation.switchWorktree(path);
      }}
      onWorktreeCreate={branchMutation.createWorktree}
      onExecuteCommand={(command) => {
        void executePromptCommand(command);
      }}
      onExecuteReview={(target) => {
        void executeReviewTarget(target);
      }}
      onFastModeChange={(enabled) => {
        setFastModeSelection({ enabled, scope: composerScope });
        void Promise.resolve(onFastModeChange(enabled, activeSettings)).catch(() => undefined);
      }}
      onInterrupt={() => {
        void interruptTurn();
      }}
      onOpenProjectPath={onOpenProjectPath}
      onProjectRootChange={onProjectRootChange}
      onOpenReviewBranches={() => {
        setActiveCommandIndex(0);
        setReviewMenuMode("branches");
      }}
      onPromptChange={(content, text, cursorOffset) => {
        handlePromptChange(content, text, cursorOffset);
        todoEditing.discardIfEmpty(attachments.length > 0 || !isPromptSkillContentEmpty(content));
      }}
      onPromptHistoryNavigate={navigatePromptHistory}
      onSelectActiveCommand={selectActiveCommandItem}
      onSelectAttachmentKind={setAttachmentPickerKind}
      onSelectFileReference={selectFileReference}
      onSelectSkill={selectSkill}
      onSettingsChange={updateSettings}
      onSubmit={(message) => void todoActions.submit(message)}
      onViewError={(error) => {
        setMutationError(error);
      }}
      projectPath={projectPath}
      projectPathOpenDisabled={projectPathOpenDisabled}
      projectRoots={projectRoots}
      projectToolsEnabled={projectToolsEnabled}
      projectName={projectName ?? projectId}
      projectTodos={todos}
      promptContent={promptContent}
      promptSubmissionText={promptSubmission.text}
      queuedPrompts={composerQueue.queuedPrompts}
      removeQueuedPrompt={(queuedPromptId) => {
        void composerQueue.removeQueuedPrompt(queuedPromptId).catch(setMutationError);
      }}
      reviewMenuMode={reviewMenuMode}
      sandboxModeSelectable
      selectedModel={selectedModel}
      selectedReasoningEffort={selectedReasoningEffort}
      selectedProjectRootId={selectedProjectRootId}
      setActiveCommandIndex={setActiveCommandIndex}
      skills={skills}
      skillEditorRef={skillEditorRef}
      state={state}
      steerQueuedPrompt={(queuedPrompt) => {
        void composerQueue.sendQueuedPrompt(queuedPrompt, submitPrompt).catch(setMutationError);
      }}
      submitAction={submitAction}
      switchingBranch={branchMutation.switchingBranch}
      switchingWorktree={branchMutation.switchingWorktree}
      taskId={taskId}
      turnControlsDisabled={turnControlsDisabled}
      worktrees={branchMutation.worktrees}
    />
  );
  return (
    <>
      {composerView}
      <WorkbenchComposerAttachmentPicker
        active={isCurrentScope(routeScope)}
        client={client}
        kind={attachmentPickerKind}
        onAdd={(attachment) => {
          handleAttachmentsChange([...attachments, attachment]);
        }}
        onClose={() => {
          setAttachmentPickerKind(undefined);
        }}
        projectId={projectId}
      />
    </>
  );
}
