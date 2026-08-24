import type {
  AgentCapabilities,
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshotResponse,
  AgentTurn,
  PendingRequest,
  ProjectGitStatus,
  ProjectRoot,
} from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useState, type RefObject } from "react";

import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import {
  mergeSubmittedPromptIntoSnapshot,
  type RuntimeTaskSnapshot,
} from "../../conversation/runtime/task-runtime.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
import { taskSettingsMutationOptions } from "../../projects/project-queries.js";
import type { PendingRequestResolution } from "./pending-request.js";
import { TaskTimeline } from "./task-timeline.js";
import { WorkbenchComposer, type WorkbenchComposerHandle } from "./workbench-composer.js";
import { useSubmissionStartedAt, type SubmittedPromptState } from "./workbench-shell-runtime.js";

export const ActiveTaskWorkbench = memo(function ActiveTaskWorkbench({
  capabilities,
  client,
  composerRef,
  fallbackSettings,
  fastModeAvailable,
  fastModeDefault,
  followUpBehavior,
  models,
  modelsError,
  modelsPending,
  onRequestNotificationPermission,
  onProjectTaskDefaultsChange,
  onOpenProjectPath,
  onProjectRootChange,
  onTaskStarted,
  projectId,
  projectPath,
  projectPathOpenDisabled,
  projectRoots,
  projectToolsEnabled,
  selectedProjectRootId,
  gitStatus,
  runtime,
  skills,
  startingSnapshot,
  startingPrompt,
  taskId,
  onOpenFileDiff,
  onOpenSourceFile,
  onReviewFileChanges,
}: Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentWorkbenchClient;
  composerRef: RefObject<WorkbenchComposerHandle | null>;
  fallbackSettings: AgentTaskSettings;
  fastModeAvailable: boolean;
  fastModeDefault: boolean;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onRequestNotificationPermission: () => void;
  onProjectTaskDefaultsChange: (settings: AgentTaskSettings, fastMode: boolean) => Promise<void>;
  onOpenProjectPath: () => void;
  onProjectRootChange: (rootId: string) => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
    messageAttachments?: readonly AgentMessageAttachment[],
  ) => void;
  projectId: string;
  projectPath: string;
  projectPathOpenDisabled: boolean;
  projectRoots: readonly ProjectRoot[];
  projectToolsEnabled: boolean;
  selectedProjectRootId: string;
  gitStatus?: ProjectGitStatus;
  runtime: TaskRuntimeView;
  skills: readonly AgentSkill[];
  startingSnapshot: RuntimeTaskSnapshot | undefined;
  startingPrompt: SubmittedPromptState | undefined;
  taskId: string;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
}>) {
  const queryClient = useQueryClient();
  const taskScope = `${projectId}:${taskId}`;
  const [timelineScrollToBottomSignal, setTimelineScrollToBottomSignal] = useState(0);
  const {
    beginSubmission,
    getStartedAt: getSubmissionStartedAt,
    handleSubmissionStateChange,
    startedAt: submissionStartedAt,
  } = useSubmissionStartedAt();
  const [submittedPromptState, setSubmittedPromptState] = useState<{
    prompt: SubmittedPromptState | undefined;
    taskScope: string;
  }>(() => ({ prompt: startingPrompt, taskScope }));
  const submittedPrompt =
    submittedPromptState.taskScope === taskScope ? submittedPromptState.prompt : startingPrompt;
  const retainedSubmissionStartedAt = submissionStartedAt ?? submittedPrompt?.submissionStartedAt;
  const retainedSubmissionTurnId =
    submissionStartedAt === undefined ? submittedPrompt?.turn.id : undefined;
  const visibleSnapshot =
    runtime.snapshot === undefined || submittedPrompt === undefined
      ? runtime.snapshot
      : mergeSubmittedPromptIntoSnapshot(runtime.snapshot, submittedPrompt.turn, {
          ...submittedPrompt.input,
          messageAttachments: submittedPrompt.messageAttachments,
        });
  const visibleRuntime: TaskRuntimeView =
    visibleSnapshot === runtime.snapshot ? runtime : { ...runtime, snapshot: visibleSnapshot };
  useEffect(() => {
    const store = runtime.store;
    if (store === undefined || submittedPrompt === undefined) {
      return;
    }
    const state = store.getState();
    const currentSnapshot = state.reconstructSnapshot();
    if (currentSnapshot === undefined || state.checkpoint === null) {
      return;
    }
    const mergedSnapshot = mergeSubmittedPromptIntoSnapshot(currentSnapshot, submittedPrompt.turn, {
      ...submittedPrompt.input,
      messageAttachments: submittedPrompt.messageAttachments,
    });
    if (mergedSnapshot === currentSnapshot) {
      return;
    }
    // Snapshot 尚未包含本次提交时写入归一化 Store，由权威用户 Item 到达后原子接管。
    const previousConnectionState = state.connectionState;
    const previousError = state.error;
    state.hydrate({ checkpoint: state.checkpoint, snapshot: mergedSnapshot });
    store.getState().setConnectionState(previousConnectionState);
    store.getState().setError(previousError);
  }, [runtime.snapshot, runtime.store, submittedPrompt]);
  const settingsMutation = useMutation({
    ...taskSettingsMutationOptions(projectId, taskId, client),
    onSuccess(response) {
      queryClient.setQueryData<AgentTaskSnapshotResponse>(
        ["projects", projectId, "tasks", taskId],
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                snapshot: { ...current.snapshot, settings: response.settings },
              },
      );
    },
  });
  const resolvePendingRequest = (
    request: PendingRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => client.resolvePendingRequest(request, resolution, { idempotencyKey }).then(() => undefined);
  const forkTask = async (lastTurnId: string, idempotencyKey: string) => {
    const response = await client.forkTask(projectId, taskId, { lastTurnId }, { idempotencyKey });
    // 复用统一的新任务入口，保证列表缓存先于路由切换更新。
    onTaskStarted(response.task);
  };

  return (
    <>
      <TaskTimeline
        onBuildPlan={() => composerRef.current?.buildPlan() ?? Promise.resolve(false)}
        {...(capabilities?.tasks.fork === true ? { onForkTask: forkTask } : {})}
        // Timeline 已携带 Diff 或受控文件引用，普通与临时 Task 共用同一套查看入口。
        onOpenFileDiff={onOpenFileDiff}
        onOpenSourceFile={onOpenSourceFile}
        onReviewFileChanges={onReviewFileChanges}
        onResolvePendingRequest={resolvePendingRequest}
        projectId={projectId}
        key={taskScope}
        runtime={visibleRuntime}
        scrollToBottomSignal={timelineScrollToBottomSignal}
        {...(retainedSubmissionStartedAt === undefined
          ? {}
          : { submissionStartedAt: retainedSubmissionStartedAt })}
        {...(retainedSubmissionTurnId === undefined
          ? {}
          : { submissionTurnId: retainedSubmissionTurnId })}
        taskId={taskId}
        {...(startingSnapshot === undefined ? {} : { startingSnapshot })}
      />
      <WorkbenchComposer
        composerRef={composerRef}
        capabilities={capabilities}
        client={client}
        followUpBehavior={followUpBehavior}
        fastModeAvailable={fastModeAvailable}
        fastModeDefault={fastModeDefault}
        models={models}
        modelsError={modelsError}
        modelsPending={modelsPending || runtime.isPending}
        onDirectSubmission={() => {
          beginSubmission();
          setTimelineScrollToBottomSignal((current) => current + 1);
        }}
        onOpenProjectPath={onOpenProjectPath}
        onProjectRootChange={onProjectRootChange}
        onRequestNotificationPermission={onRequestNotificationPermission}
        onFastModeChange={(enabled, settings) => onProjectTaskDefaultsChange(settings, enabled)}
        onSettingsChange={(settings, _field, fastMode) =>
          Promise.all([
            settingsMutation.mutateAsync(settings),
            onProjectTaskDefaultsChange(settings, fastMode),
          ]).then(() => undefined)
        }
        onSubmissionStateChange={handleSubmissionStateChange}
        onTaskStarted={onTaskStarted}
        onTurnStarted={(turn, input, messageAttachments) => {
          const confirmedStartedAt = getSubmissionStartedAt() ?? turn.startedAt;
          setSubmittedPromptState({
            prompt: {
              input,
              messageAttachments,
              ...(confirmedStartedAt === null ? {} : { submissionStartedAt: confirmedStartedAt }),
              turn,
            },
            taskScope,
          });
        }}
        projectId={projectId}
        projectPath={projectPath}
        projectPathOpenDisabled={projectPathOpenDisabled}
        projectRoots={projectRoots}
        projectToolsEnabled={projectToolsEnabled}
        selectedProjectRootId={selectedProjectRootId}
        {...(gitStatus === undefined ? {} : { gitStatus })}
        runtime={visibleRuntime}
        settings={visibleSnapshot?.settings ?? startingSnapshot?.settings ?? fallbackSettings}
        skills={skills}
        taskId={taskId}
      />
    </>
  );
});
