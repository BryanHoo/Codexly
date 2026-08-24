import type { CodexlyClient } from "@codexly/client";
import type { AgentTask, Project, ProjectPage } from "@codexly/protocol";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { i18n } from "../../i18n/i18n.js";
import {
  PROJECT_PINNED_TASKS_KEY,
  PROJECT_TASK_SEARCH_PAGE_SIZE,
  PROJECT_TASK_SEARCH_SOURCE_KEY,
  codexlyClient,
  taskQueueQueryKey,
  type ProjectTaskInfiniteData,
  type TaskTitleSnapshot,
  type TaskTitleUpdateOptions,
} from "./project-query-contracts.js";

export function invalidateTaskQueue(queryClient: QueryClient, projectId: string, taskId: string) {
  return queryClient.invalidateQueries({
    exact: true,
    queryKey: taskQueueQueryKey(projectId, taskId),
  });
}

export function flattenProjectTaskPages(currentData: ProjectTaskInfiniteData | undefined) {
  const taskById = new Map<string, AgentTask>();

  for (const page of currentData?.pages ?? []) {
    for (const task of page.data) {
      // 新页可能与旧页边界重叠，首个较新的 Task 版本优先。
      if (!taskById.has(task.id)) {
        taskById.set(task.id, task);
      }
    }
  }

  return [...taskById.values()];
}

export function upsertProjectInPage(
  currentPage: ProjectPage | undefined,
  project: Project,
): ProjectPage {
  if (currentPage === undefined) {
    return { data: [project], nextCursor: null };
  }
  const projectIndex = currentPage.data.findIndex((candidate) => candidate.id === project.id);
  if (projectIndex < 0) {
    return { ...currentPage, data: [...currentPage.data, project] };
  }
  return {
    ...currentPage,
    data: currentPage.data.map((candidate, index) =>
      index === projectIndex ? project : candidate,
    ),
  };
}

export function upsertProjectTaskInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  task: AgentTask,
): ProjectTaskInfiniteData {
  if (currentData === undefined || currentData.pages.length === 0) {
    return {
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: null }],
    };
  }

  // Mutation 结果先进入第一页，同时跨页去重并保留服务端 Cursor。
  const pagesWithoutTask = currentData.pages.map((page) => ({
    ...page,
    data: page.data.filter((currentTask) => currentTask.id !== task.id),
  }));
  const firstPage = pagesWithoutTask[0];

  return {
    ...currentData,
    pages: [
      {
        ...firstPage,
        data: [task, ...(firstPage?.data ?? [])],
        nextCursor: firstPage?.nextCursor ?? null,
      },
      ...pagesWithoutTask.slice(1),
    ],
  };
}

export function replaceProjectTaskInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  task: AgentTask,
): ProjectTaskInfiniteData {
  if (currentData === undefined) {
    return {
      pageParams: [undefined],
      pages: [{ data: [task], nextCursor: null }],
    };
  }

  return {
    ...currentData,
    pages: currentData.pages.map((page) => ({
      ...page,
      data: page.data.map((currentTask) => (currentTask.id === task.id ? task : currentTask)),
    })),
  };
}

export function replaceProjectTaskInQueryCaches(queryClient: QueryClient, task: AgentTask) {
  // 重命名和固定操作必须同步普通分页、固定列表与已加载的全量搜索源。
  queryClient.setQueryData<ProjectTaskInfiniteData>(
    ["projects", task.projectId, "tasks"],
    (currentData) => replaceProjectTaskInInfiniteData(currentData, task),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    ["projects", task.projectId, "tasks", PROJECT_PINNED_TASKS_KEY],
    (currentTasks) =>
      currentTasks === undefined
        ? undefined
        : task.pinned
          ? [task, ...currentTasks.filter((currentTask) => currentTask.id !== task.id)]
          : currentTasks.filter((currentTask) => currentTask.id !== task.id),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    ["projects", task.projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY],
    (currentTasks) =>
      currentTasks?.map((currentTask) => (currentTask.id === task.id ? task : currentTask)),
  );
}

function deriveStartedTaskTitle(
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): string | undefined {
  // 实时 Delta 已确认回复开始时，不等待可能落后一拍的 HTTP Snapshot 补入 Assistant Item。
  const hasAssistantReply =
    options.assistantReplyStarted === true ||
    snapshot.turns.some((turn) =>
      turn.items.some((item) => item.type === "message" && item.role === "assistant"),
    );
  if (!hasAssistantReply) {
    return undefined;
  }
  if (snapshot.title !== "新聊天") {
    return snapshot.title;
  }

  for (const turn of snapshot.turns) {
    for (const item of turn.items) {
      if (item.type !== "message" || item.role !== "user") {
        continue;
      }
      const firstLine = item.text.trim().split(/\r?\n/u)[0]?.trim();
      if (firstLine) {
        return firstLine;
      }
      const skillName = item.skills?.[0]?.name;
      if (skillName !== undefined) {
        return skillName;
      }
      const attachmentName = item.attachments?.[0]?.name;
      if (attachmentName !== undefined) {
        return attachmentName;
      }
    }
  }
  return i18n.t("taskTitle.replying", { ns: "conversation" });
}

export function updateNewTaskTitleFromSnapshotInInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): ProjectTaskInfiniteData | undefined {
  if (currentData === undefined) {
    return undefined;
  }
  const pages = currentData.pages.map((page) => {
    const data = updateNewTaskTitleFromSnapshotInTasks(page.data, snapshot, options);
    if (data === page.data) {
      return page;
    }
    return { ...page, data };
  });
  const hasChanged = pages.some((page, pageIndex) => page !== currentData.pages[pageIndex]);
  return hasChanged ? { ...currentData, pages } : currentData;
}

export function updateNewTaskTitleFromSnapshotInTasks(
  currentTasks: readonly AgentTask[],
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions = {},
): readonly AgentTask[] {
  const title = deriveStartedTaskTitle(snapshot, options);
  if (title === undefined) {
    return currentTasks;
  }
  const taskIndex = currentTasks.findIndex(
    (task) =>
      task.id === snapshot.id && task.projectId === snapshot.projectId && task.title === "新聊天",
  );
  if (taskIndex < 0) {
    return currentTasks;
  }
  return currentTasks.map((task, index) =>
    index === taskIndex ? { ...task, title, updatedAt: snapshot.updatedAt } : task,
  );
}

export function updateTaskTitleInProjectListCaches(
  queryClient: QueryClient,
  snapshot: TaskTitleSnapshot,
  options: TaskTitleUpdateOptions,
) {
  queryClient.setQueryData<ProjectTaskInfiniteData>(
    ["projects", snapshot.projectId, "tasks"],
    (currentData) => updateNewTaskTitleFromSnapshotInInfiniteData(currentData, snapshot, options),
  );
  for (const sourceKey of [PROJECT_PINNED_TASKS_KEY, PROJECT_TASK_SEARCH_SOURCE_KEY]) {
    queryClient.setQueryData<readonly AgentTask[]>(
      ["projects", snapshot.projectId, "tasks", sourceKey],
      (currentTasks) =>
        currentTasks === undefined
          ? undefined
          : updateNewTaskTitleFromSnapshotInTasks(currentTasks, snapshot, options),
    );
  }
}

export function removeProjectTaskFromInfiniteData(
  currentData: ProjectTaskInfiniteData | undefined,
  taskId: string,
): ProjectTaskInfiniteData | undefined {
  if (currentData === undefined) {
    return undefined;
  }

  return {
    ...currentData,
    pages: currentData.pages.map((page) => ({
      ...page,
      data: page.data.filter((task) => task.id !== taskId),
    })),
  };
}

async function listAllProjectTasks(
  projectId: string,
  client: Pick<CodexlyClient, "listTasks">,
  options: Readonly<{ pinned?: true }>,
  signal?: AbortSignal,
): Promise<readonly AgentTask[]> {
  const taskById = new Map<string, AgentTask>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const pageOptions = {
      ...(cursor === undefined ? {} : { cursor }),
      limit: PROJECT_TASK_SEARCH_PAGE_SIZE,
      ...options,
    };
    const page =
      signal === undefined
        ? await client.listTasks(projectId, pageOptions)
        : await client.listTasks(projectId, pageOptions, { signal });
    for (const task of page.data) {
      // Cursor 页边界可能重叠，保留首次出现的较新任务版本。
      if (!taskById.has(task.id)) {
        taskById.set(task.id, task);
      }
    }

    if (page.nextCursor === null || requestedCursors.has(page.nextCursor)) {
      return [...taskById.values()];
    }
    requestedCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function listProjectTasksForSearch(
  projectId: string,
  client: Pick<CodexlyClient, "listTasks">,
  signal?: AbortSignal,
) {
  return listAllProjectTasks(projectId, client, {}, signal);
}

export function listPinnedProjectTasks(
  projectId: string,
  client: Pick<CodexlyClient, "listTasks">,
  signal?: AbortSignal,
) {
  return listAllProjectTasks(projectId, client, { pinned: true }, signal);
}

export function projectPinnedTasksQueryOptions(
  projectId: string,
  client: Pick<CodexlyClient, "listTasks"> = codexlyClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => listPinnedProjectTasks(projectId, client, signal),
    queryKey: ["projects", projectId, "tasks", PROJECT_PINNED_TASKS_KEY] as const,
  });
}

export function projectTaskSearchSourceQueryOptions(
  projectId: string,
  enabled: boolean,
  client: Pick<CodexlyClient, "listTasks"> = codexlyClient,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => listProjectTasksForSearch(projectId, client, signal),
    queryKey: ["projects", projectId, "tasks", PROJECT_TASK_SEARCH_SOURCE_KEY] as const,
  });
}

export async function removeArchivedProjectTaskAndRefill(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
): Promise<void> {
  const projectTaskQueryKey = ["projects", projectId, "tasks"] as const;
  queryClient.setQueryData<ProjectTaskInfiniteData>(projectTaskQueryKey, (currentData) =>
    removeProjectTaskFromInfiniteData(currentData, taskId),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    [...projectTaskQueryKey, PROJECT_PINNED_TASKS_KEY],
    (currentTasks) => currentTasks?.filter((task) => task.id !== taskId),
  );
  queryClient.setQueryData<readonly AgentTask[]>(
    [...projectTaskQueryKey, PROJECT_TASK_SEARCH_SOURCE_KEY],
    (currentTasks) => currentTasks?.filter((task) => task.id !== taskId),
  );

  // 归档会改变服务端 Cursor 边界，重新校准活动页才能稳定补足最近 5 项。
  await queryClient.invalidateQueries({ exact: true, queryKey: projectTaskQueryKey });
}

export function reorderProjectPage(
  currentPage: ProjectPage | undefined,
  projectIds: readonly string[],
): ProjectPage | undefined {
  if (currentPage === undefined) {
    return undefined;
  }
  if (
    currentPage.data.length !== projectIds.length ||
    new Set(projectIds).size !== projectIds.length
  ) {
    return undefined;
  }
  const projectById = new Map(currentPage.data.map((project) => [project.id, project]));
  const reorderedProjects = projectIds.flatMap((projectId) => {
    const project = projectById.get(projectId);
    return project === undefined ? [] : [project];
  });
  if (reorderedProjects.length !== currentPage.data.length) {
    return undefined;
  }
  return { ...currentPage, data: reorderedProjects };
}
