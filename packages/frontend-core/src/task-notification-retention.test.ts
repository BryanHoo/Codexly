import { expect, it } from "vitest";
import { createTaskNotificationStore } from "./task-notification-store.js";

it("恢复旧通知时限制历史数量、字节并优先保留未读提醒", async () => {
  const items = Array.from({ length: 1200 }, (_, index) => ({
    id: `notice-${String(index)}`,
    projectId: "project",
    taskId: `task-${String(index)}`,
    taskName: "通知标题".repeat(400),
    kind: "completed",
    createdAt: 1200 - index,
    read: index < 1100,
  }));
  let saved = JSON.stringify({ items, signatures: [] });
  const store = createTaskNotificationStore({
    getItem: () => saved,
    setItem: (_, value) => {
      saved = value;
    },
  });
  expect(store.getSnapshot().length).toBeLessThanOrEqual(500);
  expect(store.getSnapshot().filter((item) => !item.read)).toHaveLength(100);
  store.markAllRead();
  await Promise.resolve();
  expect(new TextEncoder().encode(saved).byteLength).toBeLessThanOrEqual(512 * 1024);
});

it("清空已读后任务去重信息仍然有界，最新任务不会重复提醒", async () => {
  let saved = "";
  const store = createTaskNotificationStore({
    getItem: () => null,
    setItem: (_, value) => {
      saved = value;
    },
  });
  const tasks = Array.from({ length: 2000 }, (_, index) => ({
    projectId: "project",
    taskId: `task-${String(index)}`,
    taskName: "任务",
    status: "completed" as const,
    requiresApproval: false,
    startedAt: String(index),
  }));
  store.recordActivities(tasks);
  expect(store.getSnapshot().length).toBeLessThanOrEqual(500);
  store.markAllRead();
  store.clearRead();
  await Promise.resolve();
  expect((JSON.parse(saved) as { signatures: unknown[] }).signatures.length).toBeLessThanOrEqual(
    512,
  );
  const latest = tasks.at(-1);
  if (!latest) throw new Error("应存在最新任务");
  store.recordActivities([latest]);
  expect(store.getSnapshot()).toHaveLength(0);
});

it("标记已读时批量通知平台回收，普通记录不触发回收", () => {
  const store = createTaskNotificationStore();
  const read: unknown[] = [];
  // 新生命周期接口必须可退订，不把原生通知回收耦合到 UI 或任务审批状态。
  const stop = store.subscribeRead((tasks) => read.push(tasks));
  store.recordActivities([
    {
      projectId: "project",
      taskId: "task",
      taskName: "任务",
      status: "completed",
      requiresApproval: false,
    },
  ]);
  expect(read).toHaveLength(0);
  store.markAllRead();
  expect(read).toEqual([[{ projectId: "project", taskId: "task" }]]);
  stop();
  store.clearRead();
  expect(read).toHaveLength(1);
});
