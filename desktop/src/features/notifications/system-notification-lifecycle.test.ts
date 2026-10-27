import { expect, it, vi } from "vitest";
import { createTaskNotificationStore } from "@codexly/frontend-core/task-notification-store";
import { installSystemNotificationLifecycle } from "./system-notification-lifecycle.js";

it("批量已读只发送一次撤销请求，退出后释放订阅", async () => {
  const store = createTaskNotificationStore();
  const dismiss = vi.fn().mockResolvedValue(undefined);
  const stop = installSystemNotificationLifecycle(store, dismiss);
  store.recordActivities(["a", "b"].map((taskId) => ({ projectId: "project", taskId, taskName: taskId, status: "completed", requiresApproval: false })));
  store.markAllRead();
  expect(dismiss).toHaveBeenCalledOnce();
  expect(dismiss).toHaveBeenCalledWith(expect.arrayContaining([{ projectId: "project", taskId: "a" }, { projectId: "project", taskId: "b" }]));
  stop();
  store.recordActivities([{ projectId: "project", taskId: "c", taskName: "c", status: "failed", requiresApproval: false }]);
  store.markAllRead();
  await Promise.resolve();
  expect(dismiss).toHaveBeenCalledOnce();
});
