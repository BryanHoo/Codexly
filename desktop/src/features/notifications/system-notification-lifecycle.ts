import { getTaskNotificationStore, type TaskNotificationStore } from "@codexly/frontend-core/task-notification-store";
import { dismissTaskNotifications } from "../../platform/tauri/task-activity-client.js";
import { recordInternalWarning } from "./internal-diagnostics.js";

/** 共用存储统一发布已读批次；原生回收无需逐条创建 IPC，也不依赖当前聊天是否挂载。 */
export function installSystemNotificationLifecycle(
  store: Pick<TaskNotificationStore, "subscribeRead"> = getTaskNotificationStore(),
  dismiss = dismissTaskNotifications,
): () => void {
  return store.subscribeRead((tasks) => {
    void dismiss(tasks).catch((error: unknown) => recordInternalWarning("task_notification_dismiss_failed", error));
  });
}
