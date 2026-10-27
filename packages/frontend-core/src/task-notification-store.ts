import type { AgentEvent, TaskActivitySnapshot, EventCheckpoint } from "@codexly/protocol";
import { isAsyncQuestionEvent } from "./async-question-event.js";
import {
  retainNotificationMetadata,
  retainTaskNotifications,
} from "./task-notification-retention.js";

export type TaskNotificationKind = "completed" | "failed" | "approval" | "input";
export type TaskNotification = Readonly<{
  id: string;
  projectId: string;
  taskId: string;
  taskName: string;
  kind: TaskNotificationKind;
  createdAt: number;
  read: boolean;
}>;
type NotificationStorage = Pick<Storage, "getItem" | "setItem">;
export type ReadNotificationTask = Pick<TaskNotification, "projectId" | "taskId">;
// 平台只需提供通知元数据，不耦合两端聊天 Item 的协议差异。
type NotificationEvent = Pick<AgentEvent, "taskId" | "sessionId" | "sequence" | "timestamp"> &
  (
    | {
        type: "turn.started" | "turn.completed";
        payload: { turn: { status: string; startedAt: string | null } };
      }
    | { type: "provider.error"; payload: { willRetry: boolean } }
    | { type: "pending_request.created"; payload: { request: { type: string } } }
    | {
        type: "item.completed";
        payload: {
          item: {
            id: string;
            type: string;
            role?: string;
            questions?: readonly { title: string }[];
          };
        };
      }
    | {
        type: Exclude<
          AgentEvent["type"],
          | "turn.started"
          | "turn.completed"
          | "provider.error"
          | "pending_request.created"
          | "item.completed"
        >;
      }
  );
export function isTaskNotificationEvent<T extends { type: string }>(
  event: T,
): event is Extract<
  T,
  {
    type:
      | "turn.started"
      | "turn.completed"
      | "provider.error"
      | "pending_request.created"
      | "item.completed"
      | "pending_request.resolved"
      | "pending_request.expired";
  }
> {
  const type = event.type;
  return (
    type === "turn.started" ||
    type === "turn.completed" ||
    type === "provider.error" ||
    type === "pending_request.created" ||
    type === "pending_request.resolved" ||
    type === "pending_request.expired" ||
    isAsyncQuestionEvent(event)
  );
}
const STORAGE_KEY = "codexly.task-notifications.v1";
const EMPTY: readonly TaskNotification[] = [];

function isNotification(value: unknown): value is TaskNotification {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    ["id", "projectId", "taskId", "taskName"].every((key) => typeof item[key] === "string") &&
    ["completed", "failed", "approval", "input"].includes(String(item["kind"])) &&
    typeof item["read"] === "boolean" &&
    typeof item["createdAt"] === "number" &&
    Number.isFinite(item["createdAt"])
  );
}

/** 两端共用轻量活动投影：不读取聊天正文，不创建额外订阅或轮询。 */
export function createTaskNotificationStore(storage?: NotificationStorage) {
  let items = EMPTY;
  let signatures = new Map<string, string>();
  const checkpoints = new Map<string, EventCheckpoint>();
  const listeners = new Set<() => void>();
  const readListeners = new Set<(tasks: readonly ReadNotificationTask[]) => void>();
  const publishRead = (previous: readonly TaskNotification[]) => {
    if (!readListeners.size) return;
    const unread = new Set(items.filter((item) => !item.read).map((item) => item.id));
    const unreadTasks = new Set(
      items
        .filter((item) => !item.read)
        .map((item) => JSON.stringify([item.projectId, item.taskId])),
    );
    const tasks = new Map<string, ReadNotificationTask>();
    for (const item of previous) {
      if (
        !item.read &&
        !unread.has(item.id) &&
        !unreadTasks.has(JSON.stringify([item.projectId, item.taskId]))
      ) {
        tasks.set(JSON.stringify([item.projectId, item.taskId]), {
          projectId: item.projectId,
          taskId: item.taskId,
        });
      }
    }
    if (tasks.size) for (const listener of readListeners) listener([...tasks.values()]);
  };
  let writeScheduled = false;
  const restore = () => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (
        typeof saved !== "object" ||
        saved === null ||
        !("items" in saved) ||
        !Array.isArray(saved.items)
      )
        return;
      items = retainTaskNotifications(saved.items.filter(isNotification));
      if ("signatures" in saved && Array.isArray(saved.signatures)) {
        signatures = new Map(
          saved.signatures.filter(
            (entry): entry is [string, string] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              entry.every((part) => typeof part === "string"),
          ),
        );
        retainNotificationMetadata(signatures);
      }
    } catch {
      // 隐私模式、损坏配置与配额错误均不能阻断通知和任务导航。
    }
  };
  restore();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const persist = () => {
    if (!storage || writeScheduled) return;
    writeScheduled = true;
    // 同一批活动只序列化一次，避开逐条通知的同步磁盘写入。
    queueMicrotask(() => {
      writeScheduled = false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ items, signatures: [...signatures] }));
      } catch {
        /* 保留内存中的通知，存储不可用时仍允许继续操作。 */
      }
    });
  };
  const replace = (next: readonly TaskNotification[]) => {
    if (next === items) return;
    const previous = items;
    items = retainTaskNotifications(next);
    publishRead(previous);
    publish();
    persist();
  };
  const store = {
    getSnapshot: () => items,
    getServerSnapshot: () => EMPTY,
    subscribeRead: (listener: (tasks: readonly ReadNotificationTask[]) => void) => {
      readListeners.add(listener);
      return () => {
        readListeners.delete(listener);
      };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY || event.storageArea !== storage) return;
        const previous = items;
        restore();
        publishRead(previous);
        publish();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    recordActivities(
      tasks: readonly TaskActivitySnapshot[],
      createdAt = Date.now(),
      notificationId?: string,
    ): void {
      let next: TaskNotification[] | undefined;
      let changed = false;
      for (const task of tasks) {
        const key = JSON.stringify([task.projectId, task.taskId]);
        const checkpoint = checkpoints.get(key);
        // 实时事件和全局恢复共用水位，迟到的运行快照不能重新激活已完成提醒。
        if (
          checkpoint &&
          task.checkpoint?.sessionId === checkpoint.sessionId &&
          task.checkpoint.sequence < checkpoint.sequence
        )
          continue;
        if (task.checkpoint) {
          checkpoints.delete(key);
          checkpoints.set(key, task.checkpoint);
        }
        const signature = JSON.stringify([
          task.startedAt ?? task.checkpoint?.sessionId ?? "",
          task.status,
          task.requiresApproval,
        ]);
        if (notificationId === undefined && signatures.get(key) === signature) continue;
        if (notificationId !== undefined && items.some((item) => item.id === notificationId))
          continue;
        signatures.delete(key);
        signatures.set(key, signature);
        changed = true;
        if (task.status === "running" && !task.requiresApproval) continue;
        const kind =
          notificationId !== undefined
            ? "input"
            : task.requiresApproval
              ? "approval"
              : task.status === "waiting"
                ? "input"
                : task.status;
        if (kind === "running") continue;
        const id =
          notificationId ??
          JSON.stringify([key, signature, task.checkpoint?.sequence ?? task.version ?? Date.now()]);
        const notification: TaskNotification = {
          id,
          projectId: task.projectId,
          taskId: task.taskId,
          taskName: task.taskName,
          kind,
          createdAt,
          read: false,
        };
        (next ??= [...items]).unshift(notification);
      }
      retainNotificationMetadata(signatures);
      retainNotificationMetadata(checkpoints);
      if (next) replace(next);
      else if (changed) persist();
    },
    recordEvent(projectId: string, event: NotificationEvent, taskName: string): void {
      let status: TaskActivitySnapshot["status"],
        requiresApproval = false;
      let notificationId: string | undefined;
      switch (event.type) {
        case "item.completed":
          if (!isAsyncQuestionEvent(event)) return;
          // 每条问题独立提醒；同一任务已在等待时，新问题也不能被状态去重吞掉。
          notificationId = JSON.stringify([
            projectId,
            event.taskId,
            event.sessionId,
            event.payload.item.id,
            "async-question",
          ]);
          status = "waiting";
          break;
        case "turn.started":
          status = "running";
          break;
        case "turn.completed":
          status = event.payload.turn.status === "completed" ? "completed" : "failed";
          break;
        case "provider.error":
          if (event.payload.willRetry) return;
          status = "failed";
          break;
        case "pending_request.created":
          status = "waiting";
          requiresApproval = event.payload.request.type !== "user_input";
          break;
        case "pending_request.resolved":
        case "pending_request.expired":
          status = "running";
          break;
        // 正文 Token 在构建键值、读取存储前直接返回，流式渲染不承担通知开销。
        default:
          return;
      }
      const key = JSON.stringify([projectId, event.taskId]);
      const previous = signatures.get(key);
      let previousStart: unknown;
      try {
        const signature = previous ? (JSON.parse(previous) as unknown[]) : undefined;
        previousStart = signature?.[0];
        // 新问题不改变既有审批事实；随后全局快照不应重复生成同一条审批提醒。
        if (notificationId !== undefined) requiresApproval = signature?.[2] === true;
      } catch {
        /* 旧版或损坏的去重数据不能阻断实时事件。 */
      }
      const startedAt =
        event.type === "turn.started" || event.type === "turn.completed"
          ? (event.payload.turn.startedAt ??
            (event.type === "turn.started" ? event.timestamp : previousStart))
          : previousStart;
      store.recordActivities(
        [
          {
            projectId,
            taskId: event.taskId,
            taskName,
            status,
            requiresApproval,
            checkpoint: { sessionId: event.sessionId, sequence: event.sequence },
            ...(typeof startedAt === "string" && startedAt ? { startedAt } : {}),
          },
        ],
        Number.isFinite(Date.parse(event.timestamp)) ? Date.parse(event.timestamp) : Date.now(),
        notificationId,
      );
    },
    markRead: (id: string) => {
      if (!items.some((item) => item.id === id && !item.read)) return;
      replace(items.map((item) => (item.id === id ? { ...item, read: true } : item)));
    },
    markTaskRead: (projectId: string, taskId: string) => {
      // 聚焦任务时一次确认其全部通知；同时匹配项目，避免同名任务跨项目误读。
      const matches = (item: TaskNotification) =>
        !item.read && item.projectId === projectId && item.taskId === taskId;
      // 重复聚焦或活动恢复没有新增未读时，不触发渲染与存储写入。
      if (!items.some(matches)) return;
      replace(items.map((item) => (matches(item) ? { ...item, read: true } : item)));
    },
    markAllRead: () => {
      if (items.some((item) => !item.read))
        replace(items.map((item) => (item.read ? item : { ...item, read: true })));
    },
    clearRead: () => {
      if (items.some((item) => item.read)) replace(items.filter((item) => !item.read));
    },
  };
  return store;
}

export type TaskNotificationStore = ReturnType<typeof createTaskNotificationStore>;
let singleton: TaskNotificationStore | undefined;
export function getTaskNotificationStore(): TaskNotificationStore {
  if (!singleton) {
    let storage: Storage | undefined;
    try {
      if (typeof window !== "undefined") storage = window.localStorage;
    } catch {
      /* 允许禁用存储。 */
    }
    singleton = createTaskNotificationStore(storage);
  }
  return singleton;
}
