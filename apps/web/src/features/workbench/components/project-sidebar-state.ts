import type { AgentEventConnectionState } from "@code-agent/client";
import type { AgentTask } from "@code-agent/protocol";

import { i18n } from "../../../i18n/i18n.js";

type ProjectSidebarConnectionInput = Readonly<{
  hasActiveTask: boolean;
  projectDataFailed: boolean;
  projectDataPending: boolean;
  taskConnectionState: AgentEventConnectionState;
}>;

type ProjectTaskPaginationControlInput = Readonly<{
  error: Error | null;
  hasHiddenLoadedTasks: boolean;
  hasNextPage: boolean;
  isExpanded: boolean;
  isFetchingNextPage: boolean;
}>;

export function groupTasksByProjectId(
  tasks: readonly AgentTask[],
): ReadonlyMap<string, readonly AgentTask[]> {
  const tasksByProjectId = new Map<string, AgentTask[]>();
  for (const task of tasks) {
    const projectTasks = tasksByProjectId.get(task.projectId);
    if (projectTasks === undefined) {
      tasksByProjectId.set(task.projectId, [task]);
    } else {
      projectTasks.push(task);
    }
  }
  return tasksByProjectId;
}

export function getProjectTaskPaginationControl({
  error,
  hasHiddenLoadedTasks,
  hasNextPage,
  isExpanded,
  isFetchingNextPage,
}: ProjectTaskPaginationControlInput) {
  if (!isExpanded) {
    // 新建 Task 可能让本地列表超过首屏上限，但不能因此跳过服务端下一页。
    if (hasNextPage) {
      return {
        action: "expand-and-load",
        disabled: false,
        label: i18n.t("sidebar.expand", { ns: "workbench" }),
      } as const;
    }
    return hasHiddenLoadedTasks
      ? ({
          action: "expand",
          disabled: false,
          label: i18n.t("sidebar.expand", { ns: "workbench" }),
        } as const)
      : null;
  }

  if (hasNextPage) {
    return {
      action: "load",
      disabled: isFetchingNextPage,
      label: isFetchingNextPage
        ? i18n.t("sidebar.expandLoading", { ns: "workbench" })
        : error === null
          ? i18n.t("sidebar.expand", { ns: "workbench" })
          : i18n.t("sidebar.expandRetry", { ns: "workbench" }),
    } as const;
  }

  return hasHiddenLoadedTasks
    ? ({
        action: "collapse",
        disabled: false,
        label: i18n.t("sidebar.collapse", { ns: "workbench" }),
      } as const)
    : null;
}

export function deriveProjectSidebarConnectionState({
  hasActiveTask,
  projectDataFailed,
  projectDataPending,
  taskConnectionState,
}: ProjectSidebarConnectionInput): AgentEventConnectionState {
  // 活动任务以实时终端链路为准；新任务页则使用 HTTP Runtime 的可用性作为连接依据。
  if (hasActiveTask) {
    return taskConnectionState;
  }
  if (projectDataFailed) {
    return "closed";
  }
  if (projectDataPending) {
    return "connecting";
  }
  return "connected";
}

export function getProjectSidebarConnectionStatus(connectionState: AgentEventConnectionState) {
  // 连接状态只映射稳定翻译 key，当前语言由渲染组件统一解析。
  switch (connectionState) {
    case "connected":
      return {
        labelKey: "sidebar.connection.online",
        toneClassName: "text-diff-added",
      } as const;
    case "connecting":
      return {
        labelKey: "sidebar.connection.connecting",
        toneClassName: "text-warning",
      } as const;
    case "reconnecting":
      return {
        labelKey: "sidebar.connection.reconnecting",
        toneClassName: "text-warning",
      } as const;
    case "closed":
      return {
        labelKey: "sidebar.connection.offline",
        toneClassName: "text-danger",
      } as const;
  }
}
