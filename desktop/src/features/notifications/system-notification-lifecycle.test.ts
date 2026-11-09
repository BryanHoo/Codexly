import { expect, it, vi } from "vitest";
import { markTaskNotificationsRead } from "@codexly/frontend-core/task-notification-read";
import { installSystemNotificationLifecycle } from "./system-notification-lifecycle.js";

it("查看任务时撤销对应系统通知，退出后释放订阅", async () => {
  const dismiss = vi.fn().mockResolvedValue(undefined);
  const stop = installSystemNotificationLifecycle(dismiss);
  markTaskNotificationsRead("project", "a");
  expect(dismiss).toHaveBeenCalledExactlyOnceWith([{ projectId: "project", taskId: "a" }]);
  stop();
  markTaskNotificationsRead("project", "b");
  await Promise.resolve();
  expect(dismiss).toHaveBeenCalledOnce();
});
