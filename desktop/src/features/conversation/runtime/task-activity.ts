import type {
  AgentEvent,
  AgentTaskSnapshot,
  PendingRequest,
  TaskActivitySnapshot,
} from "@/protocol/index.js";

export type TaskAttention = "approval" | "completed" | "failed" | null;

export type TaskActivity = Readonly<{
  attention: TaskAttention;
  isAwaitingApproval: boolean;
  isRunning: boolean;
}>;

type TaskActivityRecord = Readonly<{
  attention: TaskAttention;
  isRunning: boolean;
  pendingApprovalRequestIds: ReadonlySet<string>;
  projectId: string;
  startedAt: string | undefined;
  taskId: string;
  taskName: string;
}>;

export type ActiveTaskActivity = Readonly<{
  id: string;
  projectId: string;
  startedAt?: string;
  status: "approval" | "running";
  title: string;
}>;

export type TaskActivityMap = ReadonlyMap<string, TaskActivityRecord>;

const inactiveTaskActivity: TaskActivity = {
  attention: null,
  isAwaitingApproval: false,
  isRunning: false,
};

function createTaskActivityKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

function isApprovalRequest(request: PendingRequest): boolean {
  return (
    request.type === "command_approval" ||
    request.type === "terminal_input_approval" ||
    request.type === "file_change_approval" ||
    request.type === "permissions_approval" ||
    request.type === "mcp_elicitation" ||
    request.type === "plugin_install_suggestion"
  );
}

function collectPendingApprovalRequestIds(
  requests: readonly PendingRequest[],
): ReadonlySet<string> {
  return new Set(
    requests
      .filter((request) => request.status === "pending" && isApprovalRequest(request))
      .map((request) => request.requestId),
  );
}

function setsAreEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }
  return true;
}

function replaceTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
  nextRecord: TaskActivityRecord,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, taskId);
  const currentRecord = activity.get(key);
  if (
    currentRecord?.attention === nextRecord.attention &&
    currentRecord.isRunning === nextRecord.isRunning &&
    currentRecord.startedAt === nextRecord.startedAt &&
    currentRecord.taskName === nextRecord.taskName &&
    setsAreEqual(currentRecord.pendingApprovalRequestIds, nextRecord.pendingApprovalRequestIds)
  ) {
    return activity;
  }
  const nextActivity = new Map(activity);
  nextActivity.set(key, nextRecord);
  return nextActivity;
}

export function recordRunningTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivityMap {
  const currentRecord = activity.get(createTaskActivityKey(projectId, taskId));
  return replaceTaskActivity(activity, projectId, taskId, {
    attention: null,
    isRunning: true,
    pendingApprovalRequestIds: currentRecord?.pendingApprovalRequestIds ?? new Set(),
    projectId,
    startedAt: currentRecord?.startedAt ?? new Date().toISOString(),
    taskId,
    taskName: currentRecord?.taskName ?? taskId,
  });
}

export function recordNativeTaskActivity(
  activity: TaskActivityMap,
  snapshot: TaskActivitySnapshot,
): TaskActivityMap {
  const waiting = snapshot.status === "waiting";
  const requiresApproval = waiting && snapshot.requiresApproval;
  return replaceTaskActivity(activity, snapshot.projectId, snapshot.taskId, {
    attention:
      snapshot.status === "completed"
        ? "completed"
        : snapshot.status === "failed"
          ? "failed"
          : requiresApproval
            ? "approval"
            : null,
    isRunning: snapshot.status === "running" || waiting,
    pendingApprovalRequestIds: requiresApproval ? new Set(["native"]) : new Set(),
    projectId: snapshot.projectId,
    startedAt: snapshot.startedAt,
    taskId: snapshot.taskId,
    taskName: snapshot.taskName,
  });
}

export function restoreNativeTaskActivity(
  activity: TaskActivityMap,
  snapshot: TaskActivitySnapshot,
): TaskActivityMap {
  // 恢复请求发出后可能已收到实时事件；内存记录存在时必须保留更新的事件状态。
  return activity.has(createTaskActivityKey(snapshot.projectId, snapshot.taskId))
    ? activity
    : recordNativeTaskActivity(activity, snapshot);
}

export function getTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivity {
  const record = activity.get(createTaskActivityKey(projectId, taskId));
  return record === undefined
    ? inactiveTaskActivity
    : {
        attention: record.attention,
        isAwaitingApproval: record.pendingApprovalRequestIds.size > 0,
        isRunning: record.isRunning,
      };
}

export function listActiveTaskActivities(activity: TaskActivityMap): ActiveTaskActivity[] {
  const tasks: ActiveTaskActivity[] = [];
  for (const record of activity.values()) {
    const status =
      record.pendingApprovalRequestIds.size > 0
        ? "approval"
        : record.isRunning
          ? "running"
          : null;
    if (status === null) continue;
    tasks.push({
      id: record.taskId,
      projectId: record.projectId,
      status,
      title: record.taskName,
      ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    });
  }
  return tasks;
}

export function clearTaskAttention(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivityMap {
  const record = activity.get(createTaskActivityKey(projectId, taskId));
  if (record?.attention === undefined || record.attention === null) {
    return activity;
  }
  return replaceTaskActivity(activity, projectId, taskId, { ...record, attention: null });
}

export function hasActiveProjectTask(activity: TaskActivityMap, projectId: string): boolean {
  for (const record of activity.values()) {
    if (
      record.projectId === projectId &&
      (record.isRunning || record.pendingApprovalRequestIds.size > 0)
    ) {
      return true;
    }
  }
  return false;
}

export function getActiveProjectTaskIds(activity: TaskActivityMap, projectId: string): string[] {
  const taskIds: string[] = [];
  for (const record of activity.values()) {
    if (
      record.projectId === projectId &&
      (record.isRunning || record.pendingApprovalRequestIds.size > 0)
    ) {
      taskIds.push(record.taskId);
    }
  }
  return taskIds;
}

export function removeTaskActivity(
  activity: TaskActivityMap,
  projectId: string,
  taskId: string,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, taskId);
  if (!activity.has(key)) {
    return activity;
  }
  const nextActivity = new Map(activity);
  nextActivity.delete(key);
  return nextActivity;
}

export function recordTaskActivitySnapshot(
  activity: TaskActivityMap,
  snapshot: AgentTaskSnapshot,
  isViewed = false,
): TaskActivityMap {
  const currentRecord = activity.get(createTaskActivityKey(snapshot.projectId, snapshot.id));
  const pendingApprovalRequestIds = collectPendingApprovalRequestIds(snapshot.pendingRequests);
  const runningStartedAt = snapshot.turns
    .findLast((turn) => turn.status === "running")
    ?.startedAt;
  const attention: TaskAttention = isViewed
    ? null
    : pendingApprovalRequestIds.size > 0
      ? "approval"
      : snapshot.status === "running"
        ? null
        : currentRecord?.attention === "completed" || currentRecord?.attention === "failed"
          ? currentRecord.attention
          : null;
  return replaceTaskActivity(activity, snapshot.projectId, snapshot.id, {
    attention,
    isRunning: snapshot.status === "running",
    pendingApprovalRequestIds,
    projectId: snapshot.projectId,
    startedAt: runningStartedAt ?? currentRecord?.startedAt,
    taskId: snapshot.id,
    taskName: snapshot.title,
  });
}

export function reduceTaskActivityEvent(
  activity: TaskActivityMap,
  projectId: string,
  event: AgentEvent,
  isViewed = false,
): TaskActivityMap {
  const key = createTaskActivityKey(projectId, event.taskId);
  const currentRecord = activity.get(key) ?? {
    attention: null,
    isRunning: false,
    pendingApprovalRequestIds: new Set<string>(),
    projectId,
    startedAt: undefined,
    taskId: event.taskId,
    taskName: event.taskId,
  };
  let attention = currentRecord.attention;
  let isRunning = currentRecord.isRunning;
  let pendingApprovalRequestIds = currentRecord.pendingApprovalRequestIds;
  let startedAt = currentRecord.startedAt;

  switch (event.type) {
    case "turn.started":
      attention = null;
      isRunning = true;
      startedAt = event.payload.turn.startedAt ?? event.timestamp;
      break;
    case "task.status_updated":
      isRunning = event.payload.status === "running";
      if (isRunning) attention = null;
      break;
    case "turn.completed":
      // `failed` 与 `interrupted` 都是未完成终态，必须保留到用户进入 Task 或新 Turn 开始。
      attention = isViewed
        ? null
        : event.payload.turn.status === "failed" || event.payload.turn.status === "interrupted"
          ? "failed"
          : "completed";
      isRunning = false;
      pendingApprovalRequestIds = new Set();
      break;
    case "provider.error":
      if (!event.payload.willRetry) {
        // 可重试错误仍由当前 Turn 恢复；只有 Provider 明确停止重试时才提醒用户。
        attention = isViewed ? null : "failed";
        isRunning = false;
        pendingApprovalRequestIds = new Set();
      }
      break;
    case "pending_request.created":
      if (isApprovalRequest(event.payload.request)) {
        attention = isViewed ? null : "approval";
        pendingApprovalRequestIds = new Set(pendingApprovalRequestIds).add(
          event.payload.request.requestId,
        );
      }
      break;
    case "pending_request.resolved":
    case "pending_request.expired":
      if (pendingApprovalRequestIds.has(event.payload.request.requestId)) {
        const remainingApprovalRequestIds = new Set(pendingApprovalRequestIds);
        remainingApprovalRequestIds.delete(event.payload.request.requestId);
        pendingApprovalRequestIds = remainingApprovalRequestIds;
        if (remainingApprovalRequestIds.size === 0 && attention === "approval") {
          attention = null;
        }
      }
      break;
    default:
      return activity;
  }

  return replaceTaskActivity(activity, projectId, event.taskId, {
    attention,
    isRunning,
    pendingApprovalRequestIds,
    projectId,
    startedAt,
    taskId: event.taskId,
    taskName: currentRecord.taskName,
  });
}
