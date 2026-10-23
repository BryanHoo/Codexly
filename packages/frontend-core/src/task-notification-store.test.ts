import type { TaskActivitySnapshot } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createTaskNotificationStore } from "./task-notification-store.js";

const activity: TaskActivitySnapshot = {
  projectId: "project-a",
  taskId: "task-a",
  taskName: "检查构建",
  status: "completed",
  requiresApproval: false,
  version: 1,
  startedAt: "2026-10-22T00:00:00Z",
  checkpoint: { sessionId: "session-a", sequence: 1 },
};

describe("任务通知记录", () => {
  it("按项目和任务批量标为已读，重复聚焦不发布或持久化无变化的状态", async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
    };
    const store = createTaskNotificationStore(storage);
    store.recordActivities([
      activity,
      { ...activity, status: "failed" },
      { ...activity, projectId: "project-b" },
      { ...activity, taskId: "task-b" },
    ]);
    await Promise.resolve();
    storage.setItem.mockClear();
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    store.markTaskRead(activity.projectId, activity.taskId);
    expect(store.getSnapshot().filter((item) => item.read)).toHaveLength(2);
    expect(store.getSnapshot().filter((item) => !item.read)).toEqual([
      expect.objectContaining({ taskId: "task-b" }),
      expect.objectContaining({ projectId: "project-b" }),
    ]);
    await Promise.resolve();
    const snapshot = store.getSnapshot();
    store.markTaskRead(activity.projectId, activity.taskId);
    store.markTaskRead("missing", activity.taskId);
    await Promise.resolve();
    expect(store.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(createTaskNotificationStore(storage).getSnapshot()).toEqual(snapshot);
    stop();
  });

  it("收集全局任务活动，忽略运行中状态和重复快照，刷新后保留已读", async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    const store = createTaskNotificationStore(storage);
    store.recordActivities([{ ...activity, status: "running" }]);
    expect(store.getSnapshot()).toHaveLength(0);
    store.recordActivities([activity, activity]);
    expect(store.getSnapshot()).toHaveLength(1);
    const first = store.getSnapshot()[0];
    if (!first) throw new Error("应记录首条通知");
    expect(first).toMatchObject({
      projectId: "project-a",
      taskId: "task-a",
      kind: "completed",
      read: false,
    });
    store.markRead(first.id);
    store.recordActivities([{ ...activity, taskName: "新标题" }]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.read).toBe(true);
    await Promise.resolve();
    expect(createTaskNotificationStore(storage).getSnapshot()[0]?.read).toBe(true);
  });

  it("区分等待审批、输入和失败；全部已读及清理已读不影响后续新通知", () => {
    const store = createTaskNotificationStore();
    store.recordActivities([
      activity,
      { ...activity, taskId: "input", status: "waiting" },
      { ...activity, taskId: "approval", status: "waiting", requiresApproval: true },
      { ...activity, taskId: "failure", status: "failed" },
    ]);
    expect(store.getSnapshot().map((item) => item.kind)).toEqual([
      "failed",
      "approval",
      "input",
      "completed",
    ]);
    store.markAllRead();
    store.clearRead();
    expect(store.getSnapshot()).toHaveLength(0);
    store.recordActivities([activity]);
    expect(store.getSnapshot()).toHaveLength(0);
    store.recordActivities([
      {
        ...activity,
        startedAt: "2026-10-22T01:00:00Z",
        version: 2,
        checkpoint: { sessionId: "session-a", sequence: 2 },
      },
    ]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.read).toBe(false);
  });

  it("存储损坏或不可用时仍可收集通知，文本流不会触发通知更新", async () => {
    const store = createTaskNotificationStore({
      getItem: () => "{",
      setItem: () => {
        throw new Error("full");
      },
    });
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.recordActivities([activity]);
    store.recordActivities([activity]);
    expect(listener).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(store.getSnapshot()).toHaveLength(1);
    stop();
  });

  it("直接记录正在查看任务的事件，并与全局活动快照去重", () => {
    const store = createTaskNotificationStore();
    store.recordActivities([{ ...activity, status: "running" }]);
    const event = {
      type: "turn.completed",
      taskId: activity.taskId,
      payload: { turn: { status: "completed", startedAt: activity.startedAt } },
      timestamp: "2026-10-22T00:01:00Z",
      sessionId: "session-a",
      sequence: 2,
    };
    store.recordEvent(activity.projectId, event as never, "检查构建");
    store.recordActivities([activity]);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.createdAt).toBe(Date.parse(event.timestamp));
    store.recordEvent(activity.projectId, { ...event, type: "message.delta" } as never, "检查构建");
    expect(store.getSnapshot()).toHaveLength(1);
  });
});
