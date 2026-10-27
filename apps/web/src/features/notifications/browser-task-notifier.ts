import type { AgentEvent } from "@codexly/protocol";
import { isAsyncQuestionEvent } from "@codexly/frontend-core/async-question-event";
import {
  getTaskNotificationStore,
  type TaskNotificationStore,
} from "@codexly/frontend-core/task-notification-store";

import { i18n } from "../../i18n/i18n.js";
import { recordInternalWarning } from "./internal-diagnostics.js";
import { NOTIFICATION_PREFERENCE_CHANGED } from "../settings/notification-preference.js";

const MAX_FAILED_TURN_KEYS = 256;

export type BrowserNotificationHandle = Readonly<{
  addClickListener: (listener: () => void) => void;
  addCloseListener?: (listener: () => void) => void;
  close: () => void;
}>;

export type BrowserNotificationApi = Readonly<{
  getPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  show: (title: string, options: NotificationOptions) => BrowserNotificationHandle;
}>;

export type TaskNotifier = Readonly<{
  notify: (projectId: string, event: AgentEvent, taskTitle: string) => void;
  requestPermission: () => Promise<void>;
  dispose?: () => void;
}>;

type BrowserTaskNotifierOptions = Readonly<{
  api?: BrowserNotificationApi | undefined;
  focusPage?: (() => void) | undefined;
  isEnabled?: (() => boolean) | undefined;
  isPageForeground?: (() => boolean) | undefined;
  navigateToTask?: ((projectId: string, taskId: string) => void) | undefined;
  notificationStore?: Pick<TaskNotificationStore, "subscribeRead">;
  preferenceEvents?: EventTarget;
}>;

type TaskNotification = Readonly<{
  body: string;
  tag: string;
}>;

function createDefaultNotificationApi(): BrowserNotificationApi | undefined {
  if (typeof globalThis.Notification === "undefined") {
    return undefined;
  }
  const BrowserNotification = globalThis.Notification;
  return {
    getPermission: () => BrowserNotification.permission,
    requestPermission: () => BrowserNotification.requestPermission(),
    show(title, options) {
      const notification = new BrowserNotification(title, options);
      return {
        addClickListener(listener) {
          notification.addEventListener("click", listener, { once: true });
        },
        addCloseListener(listener) {
          notification.addEventListener("close", listener, { once: true });
        },
        close() {
          notification.close();
        },
      };
    },
  };
}

function createTurnKey(event: Extract<AgentEvent, { turnId: string }>): string {
  return `${event.taskId}:${event.turnId}`;
}

function mapTaskNotification(projectId: string, event: AgentEvent): TaskNotification | undefined {
  if (isAsyncQuestionEvent(event))
    return {
      body: i18n.t("notification.waitingAsyncAnswer", { ns: "conversation" }),
      tag: JSON.stringify([
        projectId,
        event.taskId,
        event.sessionId,
        event.payload.item.id,
        "async-question",
      ]),
    };
  switch (event.type) {
    case "turn.completed": {
      const body =
        event.payload.turn.status === "completed"
          ? i18n.t("notification.completed", { ns: "conversation" })
          : event.payload.turn.status === "interrupted"
            ? i18n.t("notification.interrupted", { ns: "conversation" })
            : event.payload.turn.status === "failed"
              ? i18n.t("notification.failed", { ns: "conversation" })
              : undefined;
      return body === undefined
        ? undefined
        : {
            body,
            tag: `${projectId}:${event.taskId}:${event.turnId}:terminal`,
          };
    }
    case "provider.error":
      return event.payload.willRetry
        ? undefined
        : {
            body: i18n.t("notification.failedWithMessage", {
              message: event.payload.message,
              ns: "conversation",
            }),
            tag: `${projectId}:${event.taskId}:${event.turnId}:terminal`,
          };
    case "pending_request.created":
      return {
        body:
          event.payload.request.type === "user_input"
            ? i18n.t("notification.waitingInput", { ns: "conversation" })
            : i18n.t("notification.waitingApproval", { ns: "conversation" }),
        tag: `${projectId}:${event.taskId}:${event.payload.request.requestId}:request`,
      };
    default:
      return undefined;
  }
}

class BrowserTaskNotifier implements TaskNotifier {
  readonly #handles = new Map<string, { handle: BrowserNotificationHandle; requestId?: string }>();
  readonly #disposeListeners: (() => void)[] = [];
  #disposed = false;
  readonly #api: BrowserNotificationApi | undefined;
  readonly #failedTurnKeys = new Set<string>();
  readonly #questionKeys = new Set<string>();
  readonly #focusPage: () => void;
  readonly #isEnabled: () => boolean;
  readonly #isPageForeground: () => boolean;
  readonly #navigateToTask: (projectId: string, taskId: string) => void;
  #permissionRequest: Promise<void> | undefined;

  public constructor(options: BrowserTaskNotifierOptions) {
    this.#api = options.api;
    this.#focusPage =
      options.focusPage ??
      (() => {
        globalThis.window.focus();
      });
    this.#isEnabled = options.isEnabled ?? (() => true);
    this.#isPageForeground =
      options.isPageForeground ??
      (() => globalThis.document.visibilityState === "visible" && globalThis.document.hasFocus());
    this.#navigateToTask = options.navigateToTask ?? (() => undefined);
    const store =
      options.notificationStore ??
      (typeof window === "undefined" ? undefined : getTaskNotificationStore());
    if (store)
      this.#disposeListeners.push(
        store.subscribeRead((tasks) => {
          for (const task of tasks) this.#close(JSON.stringify([task.projectId, task.taskId]));
        }),
      );
    const events = options.preferenceEvents ?? (typeof window === "undefined" ? undefined : window);
    if (events) {
      const changed = () => {
        if (!this.#isEnabled()) this.#closeAll();
      };
      events.addEventListener(NOTIFICATION_PREFERENCE_CHANGED, changed);
      events.addEventListener("storage", changed);
      this.#disposeListeners.push(() => {
        events.removeEventListener(NOTIFICATION_PREFERENCE_CHANGED, changed);
        events.removeEventListener("storage", changed);
      });
    }
  }

  #close(key: string): void {
    const entry = this.#handles.get(key);
    this.#handles.delete(key);
    try {
      entry?.handle.close();
    } catch (error) {
      recordInternalWarning("browser_notification_close_failed", error);
    }
  }

  #closeAll(): void {
    for (const key of this.#handles.keys()) this.#close(key);
  }

  public dispose(): void {
    this.#disposed = true;
    for (const stop of this.#disposeListeners.splice(0)) stop();
    this.#closeAll();
    this.#failedTurnKeys.clear();
    this.#questionKeys.clear();
  }

  public notify(projectId: string, event: AgentEvent, taskTitle: string): void {
    if (this.#disposed) return;
    // Token 和工具输出直接跳过，不在流式热路径读取 localStorage、权限或页面焦点。
    switch (event.type) {
      case "turn.completed":
      case "provider.error":
      case "pending_request.created":
      case "pending_request.resolved":
      case "pending_request.expired":
      case "turn.started":
      case "task.removed":
        break;
      default:
        if (!isAsyncQuestionEvent(event)) return;
    }
    if (!this.#isEnabled()) {
      this.#closeAll();
      return;
    }
    if (event.type === "task.removed" || event.type === "turn.started")
      this.#close(JSON.stringify([projectId, event.taskId]));
    if (event.type === "pending_request.resolved" || event.type === "pending_request.expired") {
      const key = JSON.stringify([projectId, event.taskId]);
      if (this.#handles.get(key)?.requestId === event.payload.request.requestId) this.#close(key);
      return;
    }
    if (this.#api?.getPermission() !== "granted" || this.#isPageForeground()) {
      return;
    }

    if (event.type === "provider.error" && !event.payload.willRetry) {
      const turnKey = createTurnKey(event);
      if (this.#failedTurnKeys.has(turnKey)) {
        return;
      }
      if (this.#failedTurnKeys.size >= MAX_FAILED_TURN_KEYS) {
        const oldestTurnKey = this.#failedTurnKeys.values().next().value;
        if (oldestTurnKey !== undefined) {
          this.#failedTurnKeys.delete(oldestTurnKey);
        }
      }
      this.#failedTurnKeys.add(turnKey);
    } else if (
      event.type === "turn.completed" &&
      this.#failedTurnKeys.delete(createTurnKey(event))
    ) {
      // 不可恢复错误已立即提醒；随后同 Turn 的终态只负责清理去重记录。
      return;
    }

    const taskNotification = mapTaskNotification(projectId, event);
    if (taskNotification === undefined) {
      return;
    }

    if (isAsyncQuestionEvent(event)) {
      if (this.#questionKeys.has(taskNotification.tag)) return;
      // 仅保留最近的问题身份，避免常驻页面的通知去重集合无限增长。
      if (this.#questionKeys.size >= 256) {
        const oldest = this.#questionKeys.values().next().value;
        if (oldest !== undefined) this.#questionKeys.delete(oldest);
      }
      this.#questionKeys.add(taskNotification.tag);
    }

    try {
      const normalizedTaskTitle = taskTitle.trim() || "Task";
      const notification = this.#api.show(`Codexly · ${normalizedTaskTitle}`, {
        body: taskNotification.body,
        data: { projectId, taskId: event.taskId },
        tag: taskNotification.tag,
      });
      const key = JSON.stringify([projectId, event.taskId]);
      this.#close(key);
      // 系统通知按任务替换，常驻页面最多保留 64 条回调资源，不创建轮询或每条通知的定时器。
      if (this.#handles.size >= 64) {
        const oldest = this.#handles.keys().next().value;
        if (oldest !== undefined) this.#close(oldest);
      }
      const entry = {
        handle: notification,
        ...(event.type === "pending_request.created"
          ? { requestId: event.payload.request.requestId }
          : {}),
      };
      this.#handles.set(key, entry);
      notification.addCloseListener?.(() => {
        if (this.#handles.get(key) === entry) this.#handles.delete(key);
      });
      notification.addClickListener(() => {
        if (this.#handles.get(key) !== entry) return;
        this.#close(key);
        this.#focusPage();
        this.#navigateToTask(projectId, event.taskId);
      });
    } catch (error) {
      recordInternalWarning("browser_notification_show_failed", error, {
        projectId,
        taskId: event.taskId,
      });
    }
  }

  public requestPermission(): Promise<void> {
    if (this.#disposed || !this.#isEnabled() || this.#api === undefined) {
      return Promise.resolve();
    }
    if (this.#permissionRequest !== undefined) {
      return this.#permissionRequest;
    }
    let browserPermissionRequest: Promise<NotificationPermission>;
    try {
      if (this.#api.getPermission() !== "default") {
        return Promise.resolve();
      }
      browserPermissionRequest = this.#api.requestPermission();
    } catch (error) {
      recordInternalWarning("notification_permission_failed", error);
      return Promise.resolve();
    }
    this.#permissionRequest = browserPermissionRequest
      .then(() => undefined)
      .catch((error: unknown) => {
        recordInternalWarning("notification_permission_failed", error);
      })
      .finally(() => {
        this.#permissionRequest = undefined;
      });
    return this.#permissionRequest;
  }
}

export function createBrowserTaskNotifier(options: BrowserTaskNotifierOptions = {}): TaskNotifier {
  return new BrowserTaskNotifier({
    ...options,
    api: options.api ?? createDefaultNotificationApi(),
  });
}
