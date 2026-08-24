import type {
  AgentMessageAttachment,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  AgentTurn,
  ProjectOpenAppId,
} from "@codexly/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { useAccess } from "../../access/access-context.js";
import {
  mergeSubmittedPromptIntoSnapshot,
  type RuntimeTaskSnapshot,
} from "../../conversation/runtime/task-runtime.js";
import { useTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { providerConnectionQueryOptions } from "../../provider-connection/provider-connection-queries.js";
import {
  useProjectActions,
  useProjectData,
  useProjectRootSelection,
} from "../../projects/project-context.js";
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
  projectGitDetailedStatusQueryOptions,
  projectGitStatusQueryOptions,
  projectOpenCapabilitiesQueryOptions,
  skillsQueryOptions,
  taskRenameMutationOptions,
} from "../../projects/project-queries.js";
import { useBackgroundTerminals } from "../hooks/use-background-terminals.js";
import type { SidebarSettingsSection } from "./project-sidebar-actions.js";
import { deriveProjectSidebarConnectionState } from "./project-sidebar.js";
import { getProjectFileManagerApp } from "./project-open-menu.js";
import { collectSubagents, type SubagentSelection } from "./subagent.js";
import type { WorkbenchInspectorTab } from "./workbench-inspector.js";
import {
  deriveWorkbenchInspectorActivation,
  shouldEnableProjectGitDetails,
} from "../workbench-inspector-activation.js";
import { useWorkbenchPanelLayout } from "./workbench-panel-layout.js";
import { useSubmissionStartedAt } from "./use-submission-started-at.js";

export { useSubmissionStartedAt } from "./use-submission-started-at.js";

const emptyExpandedFileTreePaths = new Set<string>();

export function taskLaunchQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "launch"] as const;
}

export type TaskLaunchState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  settings: AgentTaskSettings;
  submissionStartedAt?: string;
  task: AgentTask;
  turn: AgentTurn;
}>;

export type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  turn: AgentTurn;
}>;

export type WorkbenchShellProps = Readonly<{
  projectId: string;
  taskId?: string;
  temporary?: boolean;
}>;

export function useWorkbenchShellRuntime({
  projectId,
  taskId,
  temporary = false,
}: WorkbenchShellProps) {
  const { t } = useTranslation("workbench");
  const access = useAccess();
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
    requestNotificationPermission,
    retry,
    viewTask,
  } = useProjectActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  } = useWorkbenchPanelLayout();
  const inspectorScopeKey = `${projectId}:${taskId ?? "draft"}`;
  const defaultInspectorTab: WorkbenchInspectorTab = taskId === undefined ? "project" : "context";
  const [inspectorTabState, setInspectorTabState] = useState<{
    scopeKey: string;
    tab: WorkbenchInspectorTab;
  }>({ scopeKey: inspectorScopeKey, tab: defaultInspectorTab });
  // 标签选择绑定当前路由身份；Task 首屏进入上下文，草稿页仍以项目浏览为主。
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
  const inspectorActivation = deriveWorkbenchInspectorActivation({
    contextOnly: temporary,
    gitStatus: gitStatusQuery.data,
    inspectorOpen,
    requestedTab: inspectorTab,
    taskId,
  });
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation({
    ...appUpdateMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["app-info"], response);
    },
  });
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
    projectOpenCapabilitiesQueryOptions(projectId, client, !temporary),
  );
  const projectPathOpenMutation = useMutation({
    // 外部应用已经提供明确的成功反馈，仅保留失败 toast。
    meta: { actionNotification: { successMessage: false } },
    mutationFn: ({
      appId,
      path,
    }: Readonly<{ appId: ProjectOpenAppId; path: string | undefined }>) =>
      client.openProject(
        projectId,
        selectedRootPath,
        path === undefined ? { appId } : { appId, path },
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
    enabled: capabilities?.skills.list === true,
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
      // 局部显式设置仍由 Server 保持优先；刷新只让未配置的当前上下文重新解析全局回退。
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: ["projects", projectId, "defaults"],
      });
      if (taskId !== undefined) {
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: ["projects", projectId, "tasks", taskId],
        });
      }
    },
  });
  const runtime = useTaskRuntime(projectId, taskId, projectRuntime);
  const taskLaunchState =
    taskId === undefined
      ? undefined
      : queryClient.getQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, taskId));
  const startingSnapshot = useMemo<RuntimeTaskSnapshot | undefined>(
    () =>
      taskLaunchState === undefined
        ? undefined
        : mergeSubmittedPromptIntoSnapshot(
            {
              ...taskLaunchState.task,
              contextUsage: null,
              plan: null,
              pendingRequests: [],
              settings: taskLaunchState.settings,
              status: "running",
              turns: [taskLaunchState.turn],
              turnsNextCursor: null,
            },
            taskLaunchState.turn,
            { ...taskLaunchState.input, messageAttachments: taskLaunchState.messageAttachments },
          ),
    [taskLaunchState],
  );
  const projectTaskState = projectTaskStates.get(projectId);
  const sidebarConnectionState = deriveProjectSidebarConnectionState({
    hasActiveTask: taskId !== undefined,
    projectDataFailed: error !== null || (projectTaskState?.error ?? null) !== null,
    projectDataPending: isPending || projectTaskState?.isPending === true,
    taskConnectionState: runtime.connectionState,
  });
  const isTaskRunning =
    runtime.snapshot?.status === "running" || startingSnapshot?.status === "running";
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
  const [fileDiffSelection, setFileDiffSelection] = useState<{
    change: AgentFileChange;
    projectId: string;
  } | null>(null);
  const [fileReviewSelection, setFileReviewSelection] = useState<{
    changes: readonly AgentFileChange[];
    projectId: string;
  } | null>(null);
  const [sourceFileSelection, setSourceFileSelection] = useState<{
    kind: "image" | "source";
    projectId: string;
    reference: MessageFileReference;
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
      setFileDiffSelection(null);
      setFileReviewSelection(null);
      setSourceFileSelection(null);
    },
    [projectId, setSelectedProjectRoot],
  );

  const gitStatusDetailsQuery = useQuery(
    projectGitDetailedStatusQueryOptions(
      projectId,
      selectedRootPath ?? "",
      null,
      gitStatusQuery.data?.snapshot ?? "",
      shouldEnableProjectGitDetails({
        activePanel:
          inspectorActivation.context || inspectorActivation.project || inspectorActivation.changes,
        gitStatus: gitStatusQuery.data,
        temporary,
      }),
      client,
    ),
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
    runtime.snapshot?.title ??
    t("shell.newChat");
  const renameMutation = useMutation(taskRenameMutationOptions(client));
  const activeTaskRenameLockRef = useRef(createAsyncActionLock());
  const selectedFileChange =
    fileDiffSelection !== null && fileDiffSelection.projectId === projectId
      ? fileDiffSelection.change
      : null;
  const selectedSourceFile =
    sourceFileSelection !== null && sourceFileSelection.projectId === projectId
      ? sourceFileSelection
      : null;
  const selectedFileReview =
    fileReviewSelection !== null && fileReviewSelection.projectId === projectId
      ? fileReviewSelection.changes
      : null;
  const subagents = useMemo(
    () => collectSubagents(runtime.snapshot ?? startingSnapshot),
    [runtime.snapshot, startingSnapshot],
  );
  const selectedSubagent =
    subagentDialogSelection !== null &&
    subagentDialogSelection.projectId === projectId &&
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
    access,
    activeTaskRenameLockRef,
    appInfoQuery,
    appUpdateMutation,
    backgroundTerminals,
    beginNewChatSubmission,
    capabilities,
    client,
    error,
    expandedFileTreePaths,
    fileDiffSelection,
    fileReviewSelection,
    getNewChatSubmissionStartedAt,
    gitStatusQuery,
    gitStatusDetailsQuery,
    globalSettingsMutation,
    globalSettingsSection,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    inspectorOpen,
    inspectorMaximumWidth,
    inspectorTab,
    inspectorTask: runtime.snapshot ?? startingSnapshot,
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
    requestNotificationPermission,
    retry,
    runtime,
    selectedFileChange,
    selectedFileReview,
    selectedRootId: activeRootId,
    selectedRootPath,
    selectedSourceFile,
    selectedSubagent,
    setFileDiffSelection,
    setFileReviewSelection,
    setFileTreeExpansion,
    setGlobalSettingsSection,
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    setPendingTaskSelection,
    setSidebarOpen,
    setSidebarWidth,
    setSourceFileSelection,
    setSelectedRootId,
    setSubagentDialogSelection,
    setTaskRenameOpen,
    sidebarConnectionState,
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
