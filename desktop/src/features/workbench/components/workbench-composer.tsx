import type { AgentTaskSettings } from "@/protocol/index.js";
import { useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { getTaskStoreUserMessageIds } from "../composer-queue-state.js";
import { useProjectDrafts, useProjectDraftStore } from "../project-draft-context.js";
import {
  interruptPromptTurn,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
} from "../composer-state.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";
import { isPromptSkillContentEmpty } from "./prompt-skill-editor.js";
import { useWorkbenchBranchSwitch } from "../hooks/use-workbench-branch-switch.js";
import { useComposerQueue } from "../hooks/use-composer-queue.js";
import { useComposerMenuDismiss } from "../hooks/use-composer-menu-dismiss.js";
import { createComposerCommands } from "./workbench-composer-commands.js";
import { createProjectDraftComposerActions } from "./project-draft-composer-actions.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import { useComposerSession } from "./workbench-composer-session.js";
import { createComposerSubmission } from "./workbench-composer-submission.js";
import { createComposerHandle } from "./workbench-composer-handle.js";
import { WorkbenchComposerView } from "./workbench-composer-view.js";
export * from "./workbench-composer-contracts.js";
export * from "../composer-state.js";
export function WorkbenchComposer({
  composerRef,
  capabilities,
  captureSubmitVisible = true,
  captureSubmitLabel,
  client,
  fastModeAvailable,
  fastModeDefault,
  footerVisible = true,
  followUpBehavior,
  composerDraftId,
  initialDraft,
  initialProjectDraftId,
  models,
  modelsError,
  modelsPending,
  onDirectSubmission,
  onCaptureSubmission,
  onFastModeChange,
  onInputStateChange,
  onOpenProjectPath,
  onProjectRootChange,
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
  const projectDraftStore = useProjectDraftStore();
  const projectDrafts = useProjectDrafts(projectId);
  const initialEditingProjectDraft =
    initialProjectDraftId !== undefined &&
    projectDraftStore.read(projectId, initialProjectDraftId) !== undefined
      ? { draftId: initialProjectDraftId, projectId }
      : undefined;
  const [editingProjectDraft, setEditingProjectDraft] = useState(initialEditingProjectDraft);
  const editingProjectDraftId =
    editingProjectDraft?.projectId === projectId ? editingProjectDraft.draftId : undefined;
  const session = useComposerSession({
    capabilities,
    client,
    composerDraftId,
    editingProjectDraftId,
    gitStatus,
    models,
    initialDraft,
    onSubmissionStateChange,
    projectId,
    projectPath,
    projectToolsEnabled,
    projectDraftStore,
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
    isCurrentSubmissionTarget,
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
    attachmentUploadPromises,
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
    void Promise.resolve(onSettingsChange(nextSettings, field, fastModeSelected)).catch((error) => {
      if (!isCurrentScope(requestScope)) return;
      setSettingsOverride((current) => current?.settings === nextSettings ? undefined : current);
      setMutationError(error instanceof Error ? error : new Error("Task settings update failed"));
    });
  };
  const branchMutation = useWorkbenchBranchSwitch({
    client,
    gitStatus,
    isCurrentScope,
    projectId,
    rootPath: projectPath,
    routeScope,
  });
  useComposerMenuDismiss({
    closeCommandMenu,
    closeFileMenu,
    commandMenuOpen,
    commandSurfaceRef,
    fileMenuOpen,
    turnControlsDisabled,
  });
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
    followUpBehavior,
    fastMode: fastModeEnabled,
    isCurrentSubmissionTarget,
    onDirectSubmission,
    onCaptureSubmission,
    onGoalStarted: () => setComposerModeState(undefined),
    onSteerAccepted: composerQueue.onSteerAccepted,
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
  const hasComposerInput = !isPromptSkillContentEmpty(promptContent) || attachmentCount > 0;
  // 捕获模式的外层保存按钮只订阅轻量布尔值，避免复制完整 Composer 草稿。
  useEffect(() => onInputStateChange?.(hasComposerInput), [hasComposerInput, onInputStateChange]);
  const projectDraftActions = createProjectDraftComposerActions({
    actionLock: composerActionLock,
    attachmentUploadPromises,
    attachments,
    clearComposerInput,
    client,
    editingDraftId: editingProjectDraftId,
    fallbackErrors: {
      attachmentUpload: t("composer.attachmentUploadFailed"),
      saveDraft: t("composer.saveDraftFailed"),
    },
    hasComposerInput,
    isCurrentScope,
    isSubmitting,
    onAttachmentsChange: handleAttachmentsChange,
    onEditingComplete: () => setEditingProjectDraft(undefined),
    onPromptChange: handlePromptChange,
    projectDraftStore,
    projectId,
    promptContent,
    routeScope,
    setIsSubmitting,
    setMutationError,
    skillEditorRef,
    submitPrompt,
    uploadAttempts,
    uploadedAttachments,
  });
  useImperativeHandle(composerRef, () => createComposerHandle({
    disabled: turnControlsDisabled,
    activeTurnId,
    buildPlanPrompt: t("composer.buildPlanPrompt"),
    clearMode: () => setComposerModeState(undefined),
    referenceProjectPath,
    submitPrompt,
    submitCurrent: () =>
      submitPrompt({
        files: attachments,
        text: promptSubmission.text,
      }),
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
  const submitAction = resolveComposerSubmitAction(state, hasComposerInput, followUpBehavior, canSteer);
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
      {...(captureSubmitLabel === undefined ? {} : { captureSubmitLabel })}
      commandMenuId={commandMenuId}
      commandMenuOpen={commandMenuOpen}
      commandSurfaceRef={commandSurfaceRef}
      composerMode={composerMode}
      composerScope={composerScope}
      contextUsage={contextUsage}
      creatingBranch={branchMutation.creatingBranch}
      creatingWorktree={branchMutation.creatingWorktree}
      draftInputDisabled={draftInputDisabled}
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
      editingProjectDraftId={editingProjectDraftId}
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
      onProjectDraftDelete={(draftId) => {
        projectDraftStore.remove(projectId, draftId);
        if (editingProjectDraftId === draftId) setEditingProjectDraft(undefined);
      }}
      onProjectDraftRestore={(draftId) => {
        if (projectDraftStore.read(projectId, draftId) !== undefined) {
          if (editingProjectDraftId === undefined) clearComposerInput();
          setEditingProjectDraft({ draftId, projectId });
        }
      }}
      onProjectDraftSave={() => {
        void projectDraftActions.save();
      }}
      onAttachmentsChange={projectDraftActions.changeAttachments}
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
      onPromptChange={projectDraftActions.changePrompt}
      onPromptHistoryNavigate={navigatePromptHistory}
      onSelectActiveCommand={selectActiveCommandItem}
      onSelectAttachmentKind={setAttachmentPickerKind}
      onSelectFileReference={selectFileReference}
      onSelectSkill={selectSkill}
      onSettingsChange={updateSettings}
      onSubmit={(message) => void projectDraftActions.submit(message)}
      onViewError={(error) => {
        setMutationError(error);
      }}
      projectPath={projectPath}
      projectPathOpenDisabled={projectPathOpenDisabled}
      projectRoots={projectRoots}
      projectToolsEnabled={projectToolsEnabled}
      projectDrafts={projectDrafts}
      projectName={projectName}
      promptContent={promptContent}
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
      state={state} writeAccess={runtime?.writeAccess}
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
  if (attachmentPickerKind === undefined || draftInputDisabled) {
    return composerView;
  }
  return (
    <>
      {composerView}
      <HostAttachmentPickerDialog
        client={client}
        kind={attachmentPickerKind}
        onAdd={(attachment) => {
          if (!isCurrentScope(routeScope)) {
            return;
          }
          handleAttachmentsChange([...attachments, attachment]);
          setAttachmentPickerKind(undefined);
        }}
        onClose={() => {
          setAttachmentPickerKind(undefined);
        }}
        projectId={projectId}
      />
    </>
  );
}
