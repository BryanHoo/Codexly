import {
  isAgentFastModeAvailable,
  type AgentMessageAttachment,
  type AgentProjectDefaults,
  type AgentPromptInput,
  type AgentTask,
  type AgentTaskSettings,
  type AgentTurn,
} from "@codexly/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyProjectFileReference } from "../project-file-reference.js";

import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import {
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  replaceProjectTaskInQueryCaches,
  updateNewTaskTitleFromSnapshotInInfiniteData,
  upsertProjectTaskInInfiniteData,
  type ProjectTaskInfiniteData,
} from "../../projects/project-queries.js";
import { loadProjectGitFileDiff } from "../project-git-file-diff.js";
import {
  taskLaunchQueryKey,
  type TaskLaunchState,
  type useWorkbenchShellRuntime,
} from "./workbench-shell-runtime.js";
import { inspectorOverlayQuery, sidebarOverlayQuery } from "./workbench-panel-layout.js";

type WorkbenchShellControllerOptions = Readonly<{
  projectId: string;
  taskId?: string;
  temporary?: boolean;
}>;

export function createProjectTaskDefaults(
  settings: AgentTaskSettings,
  fastMode: boolean,
): AgentProjectDefaults {
  return { ...settings, fastMode };
}

export function resolveProjectFastModeDefault(
  temporary: boolean,
  projectFastMode: boolean | undefined,
  globalFastMode: boolean | undefined,
): boolean {
  return temporary ? (globalFastMode ?? false) : (projectFastMode ?? globalFastMode ?? false);
}

export function useWorkbenchShellController(
  shell: ReturnType<typeof useWorkbenchShellRuntime>,
  { projectId, taskId, temporary = false }: WorkbenchShellControllerOptions,
) {
  const {
    activeTaskRenameLockRef,
    client,
    getNewChatSubmissionStartedAt,
    globalSettingsQuery,
    gitStatusQuery,
    markTaskRunning,
    modelsQuery,
    navigate,
    projectDefaultsMutation,
    projectDefaultsQuery,
    providerConnectionQuery,
    projectPathOpenLockRef,
    projectPathOpenMutationRef,
    queryClient,
    renameMutation,
    runtime,
    selectedRootPath,
    setFileReviewSelection,
    setInspectorFileSelection,
    setInspectorOpen,
    setInspectorTab,
    setPendingTaskSelection,
    setSidebarOpen,
    setTaskRenameOpen,
    taskLaunchState,
  } = shell;
  const openFileDiff = useCallback(
    (change: AgentFileChange) => {
      setInspectorFileSelection({ change, kind: "diff", projectId });
      setInspectorTab("file");
      setInspectorOpen(true);
    },
    [projectId, setInspectorFileSelection, setInspectorOpen, setInspectorTab],
  );
  const openProjectFileDiff = useCallback(
    (change: AgentFileChange) => {
      if (selectedRootPath === undefined) return;
      void loadProjectGitFileDiff(
        queryClient,
        client,
        projectId,
        selectedRootPath,
        gitStatusQuery.data,
        change,
      )
        .then(openFileDiff)
        .catch((error: unknown) => {
          notifyActionError(error instanceof Error ? error : new Error("Git diff is unavailable"));
        });
    },
    [client, gitStatusQuery.data, openFileDiff, projectId, queryClient, selectedRootPath],
  );
  const openMessageFileReference = useCallback(
    (reference: MessageFileReference) => {
      const kind = classifyProjectFileReference(reference.path);
      if (kind === "system") {
        const mutation = projectPathOpenMutationRef.current;
        mutation.reset();
        void projectPathOpenLockRef.current
          .run(() =>
            mutation.mutateAsync({
              appId: "system-default",
              path: reference.path,
            }),
          )
          .catch(() => undefined);
        return;
      }

      setInspectorFileSelection({ kind, projectId, reference });
      // 文件选择与右栏切换在同一用户事件中完成，避免先渲染空标签。
      setInspectorTab("file");
      setInspectorOpen(true);
    },
    [
      projectId,
      projectPathOpenLockRef,
      projectPathOpenMutationRef,
      setInspectorOpen,
      setInspectorTab,
      setInspectorFileSelection,
    ],
  );
  const openFileReview = useCallback(
    (changes: readonly AgentFileChange[]) => {
      setFileReviewSelection({ changes, projectId });
    },
    [projectId, setFileReviewSelection],
  );
  const closeTaskRenameDialog = () => {
    setTaskRenameOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-task-title-rename")?.focus();
    });
  };
  const renameActiveTask = (nextTitle: string) =>
    activeTaskRenameLockRef.current.run(async () => {
      if (taskId === undefined) {
        return;
      }
      try {
        const response = await renameMutation.mutateAsync({ projectId, taskId, title: nextTitle });
        // 服务端结果同时覆盖普通列表与已加载的搜索源，确保中栏和侧栏立即一致。
        replaceProjectTaskInQueryCaches(queryClient, response.task);
        closeTaskRenameDialog();
      } catch {
        // 根级 MutationCache 已展示失败 toast，Dialog 保留原输入供重试。
      }
    });
  const cacheProjectTask = useCallback(
    (startedTask: AgentTask) => {
      queryClient.setQueryData<ProjectTaskInfiniteData>(
        ["projects", startedTask.projectId, "tasks"],
        (currentData) => upsertProjectTaskInInfiniteData(currentData, startedTask),
      );
      queryClient.setQueryData<readonly AgentTask[]>(
        ["projects", startedTask.projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
        (currentTasks) =>
          currentTasks === undefined
            ? undefined
            : [startedTask, ...currentTasks.filter((task) => task.id !== startedTask.id)],
      );
    },
    [queryClient],
  );
  const handleTaskCreated = useCallback(
    (startedTask: AgentTask) => {
      // 真实 taskId 返回后立即展示并选中，但保持 Project Composer 以支持失败重试。
      cacheProjectTask(startedTask);
      setPendingTaskSelection({ projectId: startedTask.projectId, taskId: startedTask.id });
    },
    [cacheProjectTask, setPendingTaskSelection],
  );
  const handleTaskStarted = useCallback(
    (
      startedTask: AgentTask,
      startedTurn?: AgentTurn,
      startedInput?: AgentPromptInput,
      settings?: AgentTaskSettings,
      messageAttachments: readonly AgentMessageAttachment[] = [],
    ) => {
      cacheProjectTask(startedTask);
      if (startedTurn !== undefined && startedInput !== undefined && settings !== undefined) {
        const confirmedStartedAt = getNewChatSubmissionStartedAt() ?? startedTurn.startedAt;
        // 跨路由保存首轮启动结果，让 Snapshot 返回前即可渲染用户消息和 AI 运行态。
        queryClient.setQueryData<TaskLaunchState>(taskLaunchQueryKey(projectId, startedTask.id), {
          input: startedInput,
          messageAttachments,
          settings,
          ...(confirmedStartedAt === null ? {} : { submissionStartedAt: confirmedStartedAt }),
          task: startedTask,
          turn: startedTurn,
        });
      }
      if (startedTurn !== undefined) {
        // 首轮 Turn 已确认运行，导航前写入 Sidebar 活动态，Review 不需要伪造用户消息。
        markTaskRunning(projectId, startedTask.id);
      }
      setPendingTaskSelection(undefined);
      void navigate({
        ...(temporary
          ? { params: { taskId: startedTask.id }, to: "/temporary/t/$taskId" as const }
          : {
              params: { projectId, taskId: startedTask.id },
              to: "/p/$projectId/t/$taskId" as const,
            }),
      });
    },
    [
      cacheProjectTask,
      getNewChatSubmissionStartedAt,
      markTaskRunning,
      navigate,
      projectId,
      queryClient,
      setPendingTaskSelection,
      temporary,
    ],
  );
  const models = modelsQuery.data?.data ?? [];
  const globalSettings = globalSettingsQuery.data?.settings;
  const projectDefaults = projectDefaultsQuery.data?.settings;
  const fastModeAvailable =
    providerConnectionQuery.data === undefined
      ? false
      : isAgentFastModeAvailable(providerConnectionQuery.data);
  const draftDefaults = temporary ? globalSettings : projectDefaults;
  const defaultModel =
    models.find((model) => model.id === draftDefaults?.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  // 仅在 Project 尚无用户选择时，服务端返回的 effective defaults 才来自 Global。
  const inheritedDraftSettings = useMemo<AgentTaskSettings>(
    () => ({
      approvalPolicy:
        draftDefaults?.approvalPolicy ?? globalSettings?.approvalPolicy ?? "on-request",
      approvalsReviewer:
        draftDefaults?.approvalsReviewer ?? globalSettings?.approvalsReviewer ?? "user",
      model: defaultModel?.id ?? draftDefaults?.model ?? "",
      reasoningEffort: draftDefaults?.reasoningEffort ?? defaultModel?.defaultReasoningEffort ?? "",
      sandboxMode: draftDefaults?.sandboxMode ?? "workspace-write",
    }),
    [defaultModel, draftDefaults, globalSettings],
  );
  const [temporaryDraftSettings, setTemporaryDraftSettings] = useState<AgentTaskSettings>();
  const draftSettings = temporary
    ? (temporaryDraftSettings ?? inheritedDraftSettings)
    : inheritedDraftSettings;
  const fastModeDefault = resolveProjectFastModeDefault(
    temporary,
    projectDefaults?.fastMode,
    globalSettings?.fastMode,
  );
  const updateProjectTaskDefaults = async (settings: AgentTaskSettings, fastMode: boolean) => {
    if (temporary) {
      return;
    }
    await projectDefaultsMutation.mutateAsync(createProjectTaskDefaults(settings, fastMode));
  };
  const updateDraftSettings = async (
    settings: AgentTaskSettings,
    _field: keyof AgentTaskSettings,
    fastMode: boolean,
  ) => {
    if (temporary) {
      setTemporaryDraftSettings(settings);
      return;
    }
    await updateProjectTaskDefaults(settings, fastMode);
  };
  const handleNewTaskProjectChange = useCallback(
    (nextProjectId: string) => {
      // 空聊天切换只移动草稿路由，首次提交时再在目标 Project 中创建真实 Task。
      void navigate({ params: { projectId: nextProjectId }, to: "/p/$projectId" });
    },
    [navigate],
  );

  const closeSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-sidebar-toggle")?.focus();
    });
  };

  const closeInspector = () => {
    setInspectorOpen(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("#workbench-inspector-toggle")?.focus();
    });
  };

  const launchTurnHasAuthoritativeUserMessage = taskLaunchState?.turn.id
    ? runtime.snapshot?.turns
        .find((turn) => turn.id === taskLaunchState.turn.id)
        ?.items.some((item) => item.type === "message" && item.role === "user") === true
    : false;

  useEffect(() => {
    if (taskId !== undefined && launchTurnHasAuthoritativeUserMessage) {
      queryClient.removeQueries({
        exact: true,
        queryKey: taskLaunchQueryKey(projectId, taskId),
      });
    }
  }, [launchTurnHasAuthoritativeUserMessage, projectId, queryClient, taskId]);

  useEffect(() => {
    const activeSnapshot = runtime.snapshot;
    if (taskId === undefined || activeSnapshot === undefined) {
      return;
    }
    // 首个 Assistant Item 出现即移除“新聊天”，Turn 结束后再由服务端正式标题校准。
    queryClient.setQueryData<ProjectTaskInfiniteData>(
      ["projects", projectId, "tasks"],
      (currentData) => updateNewTaskTitleFromSnapshotInInfiniteData(currentData, activeSnapshot),
    );
  }, [projectId, queryClient, runtime.snapshot, taskId]);

  useEffect(() => {
    // 窗口缩窄进入覆盖模式时关闭桌面面板，避免两个抽屉同时遮住主内容。
    const sidebarMedia = window.matchMedia(sidebarOverlayQuery);
    const inspectorMedia = window.matchMedia(inspectorOverlayQuery);
    const syncOverlayPanels = () => {
      if (sidebarMedia.matches) {
        setSidebarOpen(false);
      }
      if (inspectorMedia.matches) {
        setInspectorOpen(false);
      }
    };

    sidebarMedia.addEventListener("change", syncOverlayPanels);
    inspectorMedia.addEventListener("change", syncOverlayPanels);
    return () => {
      sidebarMedia.removeEventListener("change", syncOverlayPanels);
      inspectorMedia.removeEventListener("change", syncOverlayPanels);
    };
  }, [setInspectorOpen, setSidebarOpen]);

  return {
    ...shell,
    closeInspector,
    closeSidebar,
    closeTaskRenameDialog,
    draftSettings,
    fastModeDefault,
    fastModeAvailable,
    globalSettings,
    handleNewTaskProjectChange,
    handleTaskCreated,
    handleTaskStarted,
    models,
    openFileDiff,
    openProjectFileDiff,
    openFileReview,
    openMessageFileReference,
    renameActiveTask,
    updateDraftSettings,
    updateProjectTaskDefaults,
  };
}
