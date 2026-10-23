import { isAsyncQuestionEvent } from "@codexly/frontend-core/async-question-event";
import { projectTaskActivitySnapshot } from "@codexly/frontend-core/task-activity-sync";
import { taskEngine, type AgentEngine } from "@codexly/protocol";
import type {
  AgentEvent,
  AgentTaskSnapshot,
  PendingRequest,
  TaskActivitySnapshot,
} from "@/protocol/index.js";

export type TaskAttention = "approval" | "input" | "completed" | "failed" | null;

export type TaskActivity = Readonly<{
  attention: TaskAttention;
  isAwaitingApproval: boolean;
  isRunning: boolean;
}>;

type TaskActivityRecord = Readonly<{
  engine?: AgentEngine | undefined;
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
  status: "approval" | "input" | "running";
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
    // 引擎元数据晚于活动到达时也要更新；真正无变化时仍复用原 Map。
    currentRecord.engine === nextRecord.engine &&
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
    attention: currentRecord?.attention === "input" ? "input" : null,
    engine: currentRecord?.engine,
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
  const currentRecord = activity.get(createTaskActivityKey(snapshot.projectId, snapshot.taskId));
  return replaceTaskActivity(activity, snapshot.projectId, snapshot.taskId, {
    ...projectTaskActivitySnapshot(snapshot),
    // 活动快照不猜测引擎，保留完整任务或既有记录已确认的归属。
    engine: currentRecord?.engine,
    startedAt: snapshot.startedAt,
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
        : record.attention === "input"
          ? "input"
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
  if (record?.attention === undefined || record.attention === null || record.attention === "input") {
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
  const attention: TaskAttention = currentRecord?.attention === "input" && snapshot.status === "running"
    ? "input"
    : isViewed
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
    // 只有完整任务快照缺少引擎时，才按旧任务兼容规则回退为 Codex。
    engine: taskEngine(snapshot),
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
  const currentRecord: TaskActivityRecord = activity.get(key) ?? {
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
    case "item.completed":
      if (!isAsyncQuestionEvent(event)) return activity;
      // 待回答是尚未处理的事实，进入任务或后续运行事件不能把它当作已读提醒清除。
      attention = "input";
      isRunning = true;
      break;
    case "task.metadata_changed":
      // 运行中分组使用独立活动记录；标题事件必须同步更新，不能等待下一次快照。
      return event.payload.title === undefined ? activity : replaceTaskActivity(activity, projectId, event.taskId, {
        ...currentRecord, taskName: event.payload.title,
      });
    case "turn.started":
      attention = null;
      isRunning = true;
      startedAt = event.payload.turn.startedAt ?? event.timestamp;
      break;
    case "task.status_updated":
      isRunning = event.payload.status === "running";
      if (isRunning && attention !== "input") attention = null;
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
        if (attention !== "input") attention = isViewed ? null : "approval";
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
    // 事件不含完整任务，保留已知引擎；首次只有事件时维持未知，不从 provider 猜测。
    engine: currentRecord.engine,
    isRunning,
    pendingApprovalRequestIds,
    projectId,
    startedAt,
    taskId: event.taskId,
    taskName: currentRecord.taskName,
  });
}
