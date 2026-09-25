import type {
  AgentMessageAttachment,
  AgentPromptInput,
  AgentTask,
  AgentTaskSnapshot,
  AgentTaskSettings,
  AgentTurn,
  EventCheckpoint,
} from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  mergeSubmittedPromptIntoSnapshot,
  type RuntimeTaskSnapshot,
} from "../../conversation/runtime/task-runtime.js";
import { useTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { useInspectorTask } from "./use-inspector-task.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { providerConnectionQueryOptions } from "../../provider-connection/provider-connection-queries.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import { isGitUnavailableError } from "../../projects/project-git-error.js";
import { shouldRefreshTaskDefaults } from "../../projects/global-settings-effects.js";
import { useProjectActions, useProjectData, useProjectRootSelection } from "../../projects/project-context.js";
import { resolveProjectRootFromSelections } from "../../projects/project-root-selection.js";
import {
  appInfoQueryOptions,
  appUpdateMutationOptions,
  globalSettingsMutationOptions,
  globalSettingsQueryOptions,
  mcpServersQueryOptions,
  mcpServersReloadMutationOptions,
  modelsQueryOptions,
  projectDefaultsMutationOptions,
  projectDefaultsQueryOptions,
  projectGitStatusQueryOptions,
  projectOpenCapabilitiesQueryOptions,
  skillsQueryOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { useBackgroundTerminals } from "../hooks/use-background-terminals.js";
import { useProjectGitStatusRouteRefresh } from "../hooks/use-project-git-status-route-refresh.js";
import type { SidebarSettingsSection } from "./project-sidebar-actions.js";
import { getProjectFileManagerApp } from "./project-open-menu.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import type {
  WorkbenchInspectorFileSelection,
  WorkbenchInspectorTab,
} from "./workbench-inspector.js";
import {
  deriveWorkbenchInspectorActivation,
  deriveWorkbenchInspectorContextActivation,
  getDefaultWorkbenchInspectorTab,
  type WorkbenchInspectorContextArtifactState,
} from "../workbench-inspector-activation.js";
import { shouldEnableWorkbenchSkills } from "../workbench-query-availability.js";
import { useWorkbenchPanelLayout } from "./workbench-panel-layout.js";
import { useSubmissionStartedAt } from "./use-submission-started-at.js";
import {
  createProjectOpenRequest,
  type ProjectPathOpenInput,
} from "../project-file-reference.js";
export { useSubmissionStartedAt } from "./use-submission-started-at.js";
const emptyExpandedFileTreePaths = new Set<string>();
export function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

export type TaskLaunchState = Readonly<{
  checkpoint: EventCheckpoint;
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  settings: AgentTaskSettings;
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}>;

export function createTaskLaunchSnapshot(taskLaunchState: TaskLaunchState): AgentTaskSnapshot {
  const snapshot = mergeSubmittedPromptIntoSnapshot(
    {
      ...taskLaunchState.task,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      settings: taskLaunchState.settings,
      status: "running",
      turns: [taskLaunchState.turn],
      turnsNextCursor: null,
    },
    taskLaunchState.turn,
    { ...taskLaunchState.input, messageAttachments: taskLaunchState.messageAttachments },
  );
  return { ...snapshot, pendingRequests: [] };
}

export type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  turn: AgentTurn;
}>;

export type WorkbenchShellProps = Readonly<{
  board?: boolean;
  draftId?: string;
  projectId: string;
  scheduledTasks?: boolean;
  extensionSection?: string;
  taskId?: string;
  temporary?: boolean;
}>;

export function useWorkbenchShellRuntime({
  projectId,
  taskId,
  temporary = false,
}: WorkbenchShellProps) {
  const { t } = useTranslation("workbench");
  const { capabilities, client, error, isPending, projects, projectTaskStates, tasks } =
    useProjectData();
  const project = projects.find((item) => item.id === projectId);
  const { selectedRootIds, setSelectedProjectRoot } = useProjectRootSelection();
  const selectedRoot = resolveProjectRootFromSelections(project, selectedRootIds);
  const activeRootId = temporary ? undefined : selectedRoot?.id;
  const selectedRootPath = temporary ? undefined : selectedRoot?.path;
  const {
    markTaskRunning,
    projectRuntime,
    refreshProjectGitStatus,
    retry,
    viewTask,
  } = useProjectActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inspectorScopeKey = `${projectId}:${taskId ?? "draft"}`;
  const {
    inspectorMaximumWidth,
    inspectorOpen,
    inspectorWidth,
    setInspectorOpen,
    setInspectorWidth,
    setSidebarOpen,
    setSidebarWidth,
    sidebarOpen,
    sidebarWidth,
    workbenchShellRef,
  } = useWorkbenchPanelLayout({ temporary, scopeKey: inspectorScopeKey });
  const defaultInspectorTab: WorkbenchInspectorTab = getDefaultWorkbenchInspectorTab(temporary);
  const [inspectorTabState, setInspectorTabState] = useState<{
    scopeKey: string;
    tab: WorkbenchInspectorTab;
  }>({ scopeKey: inspectorScopeKey, tab: defaultInspectorTab });
  const [inspectorFileSelection, setInspectorFileSelection] = useState<
    (WorkbenchInspectorFileSelection & { projectId: string }) | null
  >(null);
  // 标签选择绑定当前路由身份；普通 Task 启动后继续展示项目面板。
  const inspectorTab =
    inspectorTabState.scopeKey === inspectorScopeKey ? inspectorTabState.tab : defaultInspectorTab;
  const gitStatusQuery = useQuery(
    projectGitStatusQueryOptions(
      projectId,
      selectedRootPath ?? "",
      client,
      !temporary && selectedRootPath !== undefined,
    ),
  );
  useProjectGitStatusRouteRefresh(inspectorScopeKey, !temporary && selectedRootPath !== undefined, gitStatusQuery);
  useEffect(() => {
    if (gitStatusQuery.error === null) return;
    recordInternalWarning("git_status_query_failed", gitStatusQuery.error, { projectId });
    if (isGitUnavailableError(gitStatusQuery.error)) notifyActionError(gitStatusQuery.error);
  }, [gitStatusQuery.error, projectId]);
  const inspectorActivation = deriveWorkbenchInspectorActivation({
    contextOnly: temporary,
    fileOpen: inspectorFileSelection?.projectId === projectId,
    gitStatus: gitStatusQuery.data,
    inspectorOpen,
    requestedTab: inspectorTab,
    taskId,
  });
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation(appUpdateMutationOptions(client));
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const providerConnectionQuery = useQuery(providerConnectionQueryOptions());
  const mcpServersQuery = useQuery(
    mcpServersQueryOptions(projectId, taskId, client, inspectorActivation.context),
  );
  const mcpServersReloadMutation = useMutation({
    ...mcpServersReloadMutationOptions(projectId, taskId, client),
    onSuccess(response) {
      queryClient.setQueryData(
        ["projects", projectId, "tasks", taskId ?? null, "mcp-servers"],
        response,
      );
    },
  });
  const globalSettingsQuery = useQuery(globalSettingsQueryOptions(client));
  const projectOpenCapabilitiesQuery = useQuery(
    projectOpenCapabilitiesQueryOptions(client),
  );
  const projectPathOpenMutation = useMutation({
    // 外部应用已经提供明确的成功反馈，仅保留失败 toast。
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (input: ProjectPathOpenInput) =>
      client.openProject(
        projectId,
        selectedRootPath,
        createProjectOpenRequest(input, taskId),
      ),
  });
  const taskAttachmentOpenMutation = useMutation({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: ({ attachmentId, taskId }: Readonly<{ attachmentId: string; taskId: string }>) =>
      client.openTaskAttachment(projectId, taskId, attachmentId),
  });
  const projectPathOpenMutationRef = useRef(projectPathOpenMutation);
  projectPathOpenMutationRef.current = projectPathOpenMutation;
  const projectPathOpenLockRef = useRef(createAsyncActionLock());
  const projectFileManagerApp = getProjectFileManagerApp(
    projectOpenCapabilitiesQuery.data?.apps ?? [],
  );
  const openProjectFolder = useCallback(() => {
    if (projectFileManagerApp === undefined) {
      return;
    }
    const mutation = projectPathOpenMutationRef.current;
    mutation.reset();
    void projectPathOpenLockRef.current
      .run(() => mutation.mutateAsync({ appId: projectFileManagerApp.id, path: undefined }))
      .catch(() => undefined);
  }, [projectFileManagerApp, projectPathOpenLockRef, projectPathOpenMutationRef]);
  const skillsQuery = useQuery({
    ...skillsQueryOptions(projectId, client),
    enabled: shouldEnableWorkbenchSkills(capabilities?.skills.list === true, temporary),
  });
  const projectDefaultsQuery = useQuery(projectDefaultsQueryOptions(projectId, client, !temporary));
  const projectDefaultsMutation = useMutation({
    ...projectDefaultsMutationOptions(projectId, client),
    onSuccess(response) {
      queryClient.setQueryData(["projects", projectId, "defaults"], response);
    },
  });
  const globalSettingsMutation = useMutation({
    ...globalSettingsMutationOptions(client),
    async onSuccess(response) {
      queryClient.setQueryData(["settings"], response);
      if (!shouldRefreshTaskDefaults(response.changedFields)) {
        return;
      }
      // 仅任务默认字段变化时，重新解析未配置的 Project 与当前 Task 回退值。
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: ["projects", projectId, "defaults"],
      });
      if (taskId !== undefined) {
        await projectRuntime.refreshTaskSnapshot(projectId, taskId);
      }
    },
  });
  const taskLaunchState =
    taskId === undefined
      ? undefined
      : queryClient.getQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, taskId));
  const runtime = useTaskRuntime(projectId, taskId, projectRuntime);
  const startingSnapshot = useMemo<RuntimeTaskSnapshot | undefined>(
    () => (taskLaunchState === undefined ? undefined : createTaskLaunchSnapshot(taskLaunchState)),
    [taskLaunchState],
  );
  const projectTaskState = projectTaskStates.get(projectId);
  const isTaskRunning =
    runtime.metadata?.status === "running" || startingSnapshot?.status === "running";
  const backgroundTerminals = useBackgroundTerminals(
    client,
    projectId,
    taskId,
    isTaskRunning,
    inspectorActivation.context,
  );
  const fileTreeScope = `${projectId}:${selectedRootPath ?? "temporary"}`;
  const [fileTreeExpansion, setFileTreeExpansion] = useState(() => ({
    paths: new Set<string>(),
    scope: fileTreeScope,
  }));
  const expandedFileTreePaths =
    fileTreeExpansion.scope === fileTreeScope
      ? fileTreeExpansion.paths
      : emptyExpandedFileTreePaths;
  const {
    beginSubmission: beginNewChatSubmission,
    getStartedAt: getNewChatSubmissionStartedAt,
    handleSubmissionStateChange: handleNewChatSubmissionStateChange,
    startedAt: newChatSubmissionStartedAt,
  } = useSubmissionStartedAt();
  const [pendingTaskSelection, setPendingTaskSelection] = useState<{
    projectId: string;
    taskId: string;
  }>();
  const [taskRenameOpen, setTaskRenameOpen] = useState(false);
  const [globalSettingsSection, setGlobalSettingsSection] = useState<SidebarSettingsSection | null>(
    null,
  );
  const [projectFileDialogSelection, setProjectFileDialogSelection] = useState<
    (WorkbenchInspectorFileSelection & { projectId: string }) | null
  >(null);
  const [fileReviewSelection, setFileReviewSelection] = useState<{
    changes: readonly AgentFileChange[];
    projectId: string;
  } | null>(null);
  const [subagentDialogSelection, setSubagentDialogSelection] = useState<{
    parentTaskId: string;
    projectId: string;
    selection: SubagentSelection;
  } | null>(null);
  const setSelectedRootId = useCallback(
    (rootId: string) => {
      setSelectedProjectRoot(projectId, rootId);
      // 根切换后关闭旧根派生的详情，避免相同相对路径被误解为新根文件。
      setProjectFileDialogSelection(null);
      setFileReviewSelection(null);
      setInspectorFileSelection(null);
    },
    [projectId, setSelectedProjectRoot],
  );


  const setInspectorTab = useCallback(
    (tab: WorkbenchInspectorTab) => {
      setInspectorTabState({ scopeKey: inspectorScopeKey, tab });
    },
    [inspectorScopeKey],
  );

  useLayoutEffect(() => {
    // 路由提交后、页面绘制前消费提醒，避免实时终态与被动 Effect 形成竞态。
    viewTask(projectId, taskId);
  }, [projectId, taskId, viewTask]);
  const projectName = temporary ? t("shell.temporaryTask") : (project?.name ?? projectId);
  const projectPath = selectedRootPath ?? "";
  const title =
    tasks.find((task) => task.projectId === projectId && task.id === taskId)?.title ??
    runtime.metadata?.title ??
    t("shell.newChat");
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const activeTaskRenameLockRef = useRef(createAsyncActionLock());
  const selectedProjectFileDialog =
    projectFileDialogSelection?.projectId === projectId ? projectFileDialogSelection : null;
  const selectedInspectorFile =
    inspectorFileSelection?.projectId === projectId ? inspectorFileSelection : null;
  const selectedFileReview =
    fileReviewSelection?.projectId === projectId ? fileReviewSelection.changes : null;
  const inspectorTask = useInspectorTask(runtime.store, inspectorOpen, startingSnapshot);
  const hasInspectorGoal = inspectorTask?.goal !== null && inspectorTask?.goal !== undefined;
  const hasInspectorPlan = inspectorTask?.plan !== null && inspectorTask?.plan !== undefined;
  const previousInspectorContextArtifactState = useRef<WorkbenchInspectorContextArtifactState>({
    goal: false,
    plan: false,
    scopeKey: inspectorScopeKey,
  });
  useEffect(() => {
    const currentArtifactState = {
      goal: hasInspectorGoal,
      plan: hasInspectorPlan,
      scopeKey: inspectorScopeKey,
    };
    const activation = deriveWorkbenchInspectorContextActivation(
      previousInspectorContextArtifactState.current,
      currentArtifactState,
    );
    previousInspectorContextArtifactState.current = currentArtifactState;
    if (activation.activateContext) {
      setInspectorTab("context");
    }
  }, [hasInspectorGoal, hasInspectorPlan, inspectorScopeKey, setInspectorTab]);
  const inspectorTurns = inspectorTask?.turns;
  const subagents = useMemo(
    () => collectSubagents(inspectorTurns === undefined ? undefined : { turns: inspectorTurns }),
    [inspectorTurns],
  );
  const selectedSubagent =
    subagentDialogSelection?.projectId === projectId &&
    subagentDialogSelection.parentTaskId === taskId
      ? {
          ...subagentDialogSelection.selection,
          status:
            subagents.find(
              (subagent) => subagent.taskId === subagentDialogSelection.selection.taskId,
            )?.status ?? subagentDialogSelection.selection.status,
        }
      : null;
  return {
    activeTaskRenameLockRef,
    appInfoQuery,
    appUpdateMutation,
    backgroundTerminals,
    beginNewChatSubmission,
    capabilities,
    client,
    error,
    expandedFileTreePaths,
    fileReviewSelection,
    getNewChatSubmissionStartedAt,
    gitStatusQuery,
    globalSettingsMutation,
    globalSettingsSection,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    inspectorOpen,
    inspectorMaximumWidth,
    inspectorTab,
    inspectorTask,
    inspectorWidth,
    isPending,
    markTaskRunning,
    mcpServersQuery,
    mcpServersReloadMutation,
    modelsQuery,
    navigate,
    newChatSubmissionStartedAt,
    openProjectFolder,
    pendingTaskSelection,
    projectDefaultsMutation,
    projectDefaultsQuery,
    projectName,
    projectRoots: project?.roots ?? [],
    projectOpenCapabilitiesQuery,
    providerConnectionQuery,
    projectFolderOpenDisabled:
      projectFileManagerApp === undefined || projectPathOpenMutation.isPending,
    projectPath,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    projectPathOpenMutationRef,
    taskAttachmentOpenMutation,
    projectRuntime,
    projectTaskState,
    projects,
    queryClient,
    refreshProjectGitStatus,
    renameMutation,
    retry,
    runtime,
    selectedFileReview,
    selectedInspectorFile,
    selectedProjectFileDialog,
    selectedRootId: activeRootId,
    selectedRootPath,
    selectedSubagent,
    setFileReviewSelection,
    setFileTreeExpansion,
    setGlobalSettingsSection,
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    setPendingTaskSelection,
    setSidebarOpen,
    setSidebarWidth,
    setInspectorFileSelection,
    setProjectFileDialogSelection,
    setSelectedRootId,
    setSubagentDialogSelection,
    setTaskRenameOpen,
    sidebarOpen,
    sidebarWidth,
    skillsQuery,
    startingSnapshot,
    subagents,
    taskLaunchState,
    temporary,
    taskRenameOpen,
    tasks,
    t,
    title,
    viewTask,
    workbenchShellRef,
  };
}
