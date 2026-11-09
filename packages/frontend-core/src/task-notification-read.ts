import { isAsyncQuestionEvent } from "./async-question-event.js";

export type ReadTask = Readonly<{ projectId: string; taskId: string }>;
type ReadListener = (tasks: readonly ReadTask[]) => void;
const listeners = new Set<ReadListener>();

/** 仅向系统通知发布任务已查看信号；不保存通知历史，也不产生存储读写。 */
export function markTaskNotificationsRead(projectId: string, taskId: string): void {
  if (listeners.size === 0) return;
  const tasks = [{ projectId, taskId }];
  for (const listener of listeners) listener(tasks);
}

/** 返回清理函数，避免工作台重挂载后保留过期的系统通知回调。 */
export function subscribeTaskNotificationsRead(listener: ReadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 只在通知相关状态事件回收提醒，逐 Token 输出不进入系统通知处理。 */
export function isTaskNotificationReadEvent(event: { type: string }): boolean {
  switch (event.type) {
    case "turn.started":
    case "turn.completed":
    case "provider.error":
    case "pending_request.created":
    case "pending_request.resolved":
    case "pending_request.expired":
      return true;
    default:
      return isAsyncQuestionEvent(event);
  }
}
