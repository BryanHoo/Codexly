import type { AgentTask } from "@/protocol/index.js";

import { i18n } from "../../../i18n/i18n.js";

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
