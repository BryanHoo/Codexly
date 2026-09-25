import type { NativeClient } from "@/platform/native-client-contract.js";
import type { AgentTask, Project, ProjectPage } from "@/protocol/index.js";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { i18n } from "../../i18n/i18n.js";
import {
  PROJECT_PINNED_TASKS_KEY,
  PROJECT_PINNED_TASK_PAGE_SIZE,
  TASK_BOARD_COMPLETED_TASKS_QUERY_KEY,
  nativeClient,
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

export async function cacheCreatedProjectTask(queryClient: QueryClient, task: AgentTask) {
  const projectTasksQueryKey = ["projects", task.projectId, "tasks"] as const;

  // 先终止创建前发出的旧列表请求，避免其响应覆盖刚写入的新 Task。
  await queryClient.cancelQueries({ exact: true, queryKey: projectTasksQueryKey });
  queryClient.setQueryData<ProjectTaskInfiniteData>(projectTasksQueryKey, (currentData) =>
    upsertProjectTaskInInfiniteData(currentData, task),
  );
  void queryClient.invalidateQueries({ queryKey: ["global-search"], refetchType: "none" });
}

function promoteStartedTaskInTasks(
  currentTasks: readonly AgentTask[] | undefined,
  taskId: string,
  updatedAt: string,
): readonly AgentTask[] | undefined {
  if (currentTasks === undefined) {
    return undefined;
  }
  const task = currentTasks.find((currentTask) => currentTask.id === taskId);
  return task === undefined
    ? currentTasks
    : [{ ...task, updatedAt }, ...currentTasks.filter((currentTask) => currentTask.id !== taskId)];
}

export async function refreshStartedProjectTask(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
  updatedAt: string,
): Promise<void> {
  const projectTasksQueryKey = ["projects", projectId, "tasks"] as const;
  await queryClient.cancelQueries({ exact: true, queryKey: projectTasksQueryKey });
  const startedTask = flattenProjectTaskPages(
    queryClient.getQueryData<ProjectTaskInfiniteData>(projectTasksQueryKey),
  ).find((currentTask) => currentTask.id === taskId);

  // 先跨页置顶，避免等待 thread/list 往返；随后由权威首屏顺序校准分页 Cursor。
  queryClient.setQueryData<ProjectTaskInfiniteData>(projectTasksQueryKey, (currentData) => {
    return startedTask === undefined
      ? currentData
      : upsertProjectTaskInInfiniteData(currentData, { ...startedTask, updatedAt });
  });
  queryClient.setQueryData<readonly AgentTask[]>(
    [...projectTasksQueryKey, PROJECT_PINNED_TASKS_KEY],
    (currentTasks) => promoteStartedTaskInTasks(currentTasks, taskId, updatedAt),
  );
  await queryClient.invalidateQueries({ exact: true, queryKey: projectTasksQueryKey });
  if (startedTask === undefined) {
    return;
  }
  queryClient.setQueryData<ProjectTaskInfiniteData>(projectTasksQueryKey, (currentData) => {
    const refreshedTaskExists = flattenProjectTaskPages(currentData).some(
      (currentTask) => currentTask.id === taskId,
    );
    // thread/list 可能短暂落后于 thread/start，不能让旧页移除已确认运行的 Task。
    return refreshedTaskExists
      ? currentData
      : upsertProjectTaskInInfiniteData(currentData, { ...startedTask, updatedAt });
  });
}

export async function cacheCompletedProjectTask(queryClient: QueryClient, task: AgentTask) {
  const matchingQueryKeys = queryClient
    .getQueriesData<ProjectTaskInfiniteData>({ queryKey: TASK_BOARD_COMPLETED_TASKS_QUERY_KEY })
    .flatMap(([queryKey, currentData]) => {
      const selectedProjectId = queryKey[2];
      return currentData !== undefined &&
        (selectedProjectId === null || selectedProjectId === task.projectId)
        ? [queryKey]
        : [];
    });

  // 终止可能返回旧 active 状态的列表请求，再把权威快照插入已挂载的完成列表。
  await Promise.all(
    matchingQueryKeys.map((queryKey) =>
      queryClient.cancelQueries({ exact: true, queryKey }),
    ),
  );
  for (const queryKey of matchingQueryKeys) {
    queryClient.setQueryData<ProjectTaskInfiniteData>(queryKey, (currentData) =>
      currentData === undefined ? undefined : upsertProjectTaskInInfiniteData(currentData, task),
    );
  }
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
  // 重命名和固定操作同步普通分页与固定列表，并使聚合搜索缓存失效。
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
  void queryClient.invalidateQueries({ queryKey: ["global-search"], refetchType: "none" });
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
  queryClient.setQueryData<readonly AgentTask[]>(
    ["projects", snapshot.projectId, "tasks", PROJECT_PINNED_TASKS_KEY],
    (currentTasks) =>
      currentTasks === undefined
        ? undefined
        : updateNewTaskTitleFromSnapshotInTasks(currentTasks, snapshot, options),
  );
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
  client: Pick<NativeClient, "listTasks">,
  options: Readonly<{ pinned?: true }>,
  signal?: AbortSignal,
): Promise<readonly AgentTask[]> {
  const taskById = new Map<string, AgentTask>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const pageOptions = {
      ...(cursor === undefined ? {} : { cursor }),
      limit: PROJECT_PINNED_TASK_PAGE_SIZE,
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

export function listPinnedProjectTasks(
  projectId: string,
  client: Pick<NativeClient, "listTasks">,
  signal?: AbortSignal,
) {
  return listAllProjectTasks(projectId, client, { pinned: true }, signal);
}

export function projectPinnedTasksQueryOptions(
  projectId: string,
  client: Pick<NativeClient, "listTasks"> = nativeClient,
) {
  // 注入的 client 不参与项目任务缓存身份，避免破坏既有前缀失效与直接写缓存逻辑。
  // oxlint-disable-next-line @tanstack/query/exhaustive-deps
  return queryOptions({
    queryFn: ({ signal }) => listPinnedProjectTasks(projectId, client, signal),
    queryKey: ["projects", projectId, "tasks", PROJECT_PINNED_TASKS_KEY] as const,
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
  void queryClient.invalidateQueries({ queryKey: ["global-search"], refetchType: "none" });

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
