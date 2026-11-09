import { subscribeTaskNotificationsRead } from "@codexly/frontend-core/task-notification-read";
import { dismissTaskNotifications } from "../../platform/tauri/task-activity-client.js";
import { recordInternalWarning } from "./internal-diagnostics.js";

/** 任务已查看时撤销系统提醒；订阅不依赖底栏或聊天是否挂载。 */
export function installSystemNotificationLifecycle(
  dismiss = dismissTaskNotifications,
): () => void {
  return subscribeTaskNotificationsRead((tasks) => {
    void dismiss(tasks).catch((error: unknown) => recordInternalWarning("task_notification_dismiss_failed", error));
  });
}
