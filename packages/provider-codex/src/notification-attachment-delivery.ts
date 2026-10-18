import { NotificationQueueClearedError } from "./task-notification-queue.js";

/** 预算恢复同步交付占位结果，保证队列随后交付终态时附件事件已经可见。 */
export function deliverNotificationAttachment<T>(
  mapped: T | Promise<T>,
  fallback: () => T,
  signal: AbortSignal,
  publish: (value: T) => void,
  onRecovery: () => void,
): void | Promise<void> {
  if (!(mapped instanceof Promise)) {
    publish(mapped);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const recover = () => {
      try {
        if (!(signal.reason instanceof NotificationQueueClearedError)) {
          onRecovery();
          publish(fallback());
        }
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    signal.addEventListener("abort", recover, { once: true });
    void mapped
      .then((event) => {
        // 清理或占位恢复发生后，晚到的附件不得重复发布，也不能重新打开已关闭的任务。
        if (!signal.aborted) publish(event);
      })
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", recover);
      });
  });
}
