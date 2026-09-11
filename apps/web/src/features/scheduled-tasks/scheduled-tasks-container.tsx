import {
  TEMPORARY_TASK_SCOPE_ID,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskPage,
} from "@codexly/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";

import "./scheduled-tasks.css";
import type { useWorkbenchShellController } from "../workbench/components/workbench-shell-controller.js";
import { ScheduledTaskEditor } from "./components/scheduled-task-editor.js";
import { ScheduledTaskList } from "./components/scheduled-task-list.js";
import { scheduledTasksQueryOptions } from "./scheduled-task-sync.js";
import { readScheduledTaskRun } from "./scheduled-task-run.js";
import { notifyActionError } from "../notifications/action-notifications.js";

const queryKey = ["scheduled-tasks"] as const;
const emptyTasks: readonly ScheduledTask[] = [];
const noop = () => undefined;

export function ScheduledTasksContainer({
  context,
  projectId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  temporary: boolean;
}>) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const tasksQuery = useQuery(scheduledTasksQueryOptions(context.client, queryClient));
  const tasks = tasksQuery.data?.data ?? emptyTasks;
  const selectedTask = creating ? undefined : tasks.find((task) => task.id === selectedId);
  const visibleTasks = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return normalized === ""
      ? tasks
      : tasks.filter((task) =>
          `${task.name}\n${task.projectName}`.toLocaleLowerCase().includes(normalized),
        );
  }, [search, tasks]);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const saveMutation = useMutation({
    // 捕获模式由 Composer 展示保存错误，避免根级 MutationCache 再次通知。
    meta: { actionNotification: false },
    mutationFn: ({ taskId, ...input }: ScheduledTaskInput & { taskId?: string }) =>
      taskId === undefined
        ? context.client.createScheduledTask(input)
        : context.client.updateScheduledTask(taskId, input),
    onSuccess: (response) => {
      setSelectedId(response.task.id);
      setCreating(false);
      void refresh();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => context.client.deleteScheduledTask(taskId),
    onSuccess: (_response, taskId) => {
      // 删除其他任务时保留当前编辑内容与新建草稿。
      setSelectedId((current) => (current === taskId ? undefined : current));
      void refresh();
    },
  });
  const enabledMutation = useMutation({
    mutationFn: ({ enabled, taskId }: { enabled: boolean; taskId: string }) =>
      context.client.setScheduledTaskEnabled(taskId, enabled),
    onSuccess: (response) => {
      queryClient.setQueryData<ScheduledTaskPage>(queryKey, (current) =>
        current === undefined
          ? current
          : {
              data: current.data.map((task) =>
                task.id === response.task.id ? response.task : task,
              ),
            },
      );
      void refresh();
    },
  });
  const runMutation = useMutation({
    mutationFn: (taskId: string) => context.client.runScheduledTaskNow(taskId),
    onSuccess: () => void refresh(),
  });
  const openRunMutation = useMutation({
    meta: { actionNotification: false },
    mutationFn: ({ runProjectId, taskId }: { runProjectId: string; taskId: string }) =>
      readScheduledTaskRun(context.client, runProjectId, taskId),
    onError: notifyActionError,
    onSuccess: (response, { runProjectId, taskId }) => {
      if (response === null) {
        notifyActionError(context.t("scheduledTasks.runUnavailable"));
        return;
      }
      // 校验通过后预热快照，目标页面直接接管这次新读取的结果。
      queryClient.setQueryData(["projects", runProjectId, "tasks", taskId], response);
      void context.navigate(
        runProjectId === TEMPORARY_TASK_SCOPE_ID
          ? { params: { taskId }, to: "/temporary/t/$taskId" }
          : { params: { projectId: runProjectId, taskId }, to: "/p/$projectId/t/$taskId" },
      );
    },
  });
  const changeProject = (nextProjectId: string) =>
    void context.navigate(
      nextProjectId === TEMPORARY_TASK_SCOPE_ID
        ? { to: "/temporary/scheduled" }
        : { params: { projectId: nextProjectId }, to: "/p/$projectId/scheduled" },
    );
  const composerProps = {
    capabilities: context.capabilities,
    client: context.client,
    fastModeAvailable: context.fastModeAvailable,
    fastModeDefault: context.fastModeDefault,
    followUpBehavior: context.globalSettings?.followUpBehavior ?? "queue",
    models: context.models,
    modelsError: context.modelsQuery.error,
    modelsPending: context.modelsQuery.isPending,
    onFastModeChange: noop,
    onOpenProjectPath: context.openProjectFolder,
    onProjectRootChange: context.setSelectedRootId,
    onRequestNotificationPermission: noop,
    onSettingsChange: noop,
    onTaskStarted: noop,
    projectId,
    projectName: context.projectName,
    projectPath: context.projectPath,
    projectPathOpenDisabled: context.projectFolderOpenDisabled,
    projectRoots: context.projectRoots,
    projectToolsEnabled: !temporary,
    selectedProjectRootId: context.selectedRootId ?? "",
    settings: context.draftSettings,
    skills: context.skillsQuery.data?.data ?? [],
  } as const;
  return (
    <div className="scheduled-tasks">
      <ScheduledTaskList
        {...(selectedTask === undefined ? {} : { activeId: selectedTask.id })}
        loading={tasksQuery.isPending}
        onDelete={deleteMutation.mutateAsync}
        onCreate={() => {
          setCreating(true);
          setSelectedId(undefined);
        }}
        onEnabledChange={(taskId, enabled) => {
          enabledMutation.mutate({ enabled, taskId });
        }}
        onSelect={(task) => {
          setCreating(false);
          setSelectedId(task.id);
          if (task.projectId !== projectId) changeProject(task.projectId);
        }}
        query={search}
        setQuery={setSearch}
        tasks={visibleTasks}
      />
      {creating || selectedTask !== undefined ? (
        <ScheduledTaskEditor
          key={selectedTask?.id ?? `new:${projectId}`}
          composerProps={composerProps}
          openingRun={openRunMutation.isPending}
          onOpenRun={(runProjectId, taskId) => {
            if (!openRunMutation.isPending) openRunMutation.mutate({ runProjectId, taskId });
          }}
          onProjectChange={changeProject}
          onRunNow={(id) => runMutation.mutateAsync(id).then(noop)}
          onSave={(taskId, input) =>
            saveMutation
              .mutateAsync({ ...input, ...(taskId === undefined ? {} : { taskId }) })
              .then(noop)
          }
          projectId={projectId}
          projects={context.projects}
          skills={context.skillsQuery.data?.data ?? []}
          {...(selectedTask === undefined ? {} : { task: selectedTask })}
        />
      ) : (
        <div className="scheduled-task-welcome">
          <CalendarClock aria-hidden="true" />
          <h2>{context.t("scheduledTasks.welcome")}</h2>
          <p>{context.t("scheduledTasks.welcomeHint")}</p>
          <span>{context.t("scheduledTasks.selectTask")}</span>
        </div>
      )}
    </div>
  );
}
