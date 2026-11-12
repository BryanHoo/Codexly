import { expect, it, vi } from "vitest";
import type { AgentProvider } from "@codexly/core";
import { AcpTaskSubscriptions } from "./task-subscriptions.js";

function setup() {
  const subscriptions = new AcpTaskSubscriptions();
  const unsubscribeTask = vi.fn().mockResolvedValue("unsubscribed");
  const readTaskMetadata = vi.fn().mockResolvedValue({ id: "t" });
  const provider = { unsubscribeTask, readTaskMetadata } as unknown as AgentProvider;
  return { subscriptions, provider, unsubscribeTask, readTaskMetadata };
}

it("错误释放可重试，旧项目释放不能影响其他项目的持有者", async () => {
  const { subscriptions: s, provider, unsubscribeTask } = setup();
  await s.retain(provider, "p", "t", "view");
  await s.release("other", "t", "view");
  expect(unsubscribeTask).not.toHaveBeenCalled();
  unsubscribeTask.mockRejectedValueOnce(new Error("关闭失败"));
  await expect(s.release("p", "t", "view")).rejects.toThrow("关闭失败");
  await s.release("p", "t", "view");
  expect(unsubscribeTask).toHaveBeenCalledTimes(2);
});

it("忙回合的视图重新挂载后，终态不能回收新持有者", async () => {
  const { subscriptions: s, provider, unsubscribeTask } = setup();
  await s.retain(provider, "p", "t", "old");
  unsubscribeTask.mockResolvedValueOnce("busy");
  await s.release("p", "t", "old");
  await s.retain(provider, "p", "t", "new");
  await s.completed("p", "t");
  expect(unsubscribeTask).toHaveBeenCalledOnce();
  await s.release("p", "t", "new");
  expect(unsubscribeTask).toHaveBeenCalledTimes(2);
});

it("同任务释放与重挂串行，关闭失败不影响其他任务", async () => {
  const { subscriptions: s, provider, unsubscribeTask } = setup();
  await s.retain(provider, "p", "t", "old");
  const closing = Promise.withResolvers<string>();
  unsubscribeTask.mockReturnValueOnce(closing.promise);
  const release = s.release("p", "t", "old");
  const retained = vi.fn();
  const retain = s.retain(provider, "p", "t", "new").then(retained);
  await s.retain(provider, "p", "other", "view");
  expect(retained).not.toHaveBeenCalled();
  closing.resolve("unsubscribed");
  await Promise.all([release, retain]);
  await s.completed("p", "t");
  expect(unsubscribeTask).toHaveBeenCalledOnce();
});

it("目录不存在时拒绝保留，删除后忘记登记，停止后拒绝新操作", async () => {
  const { subscriptions: s, provider, unsubscribeTask, readTaskMetadata } = setup();
  readTaskMetadata.mockResolvedValueOnce(undefined);
  await expect(s.retain(provider, "p", "missing", "view")).rejects.toThrow("Task not found");
  await s.retain(provider, "p", "t", "view");
  s.forget("p", "t");
  await s.release("p", "t", "view");
  expect(unsubscribeTask).not.toHaveBeenCalled();
  s.stop();
  await expect(s.retain(provider, "p", "t", "new")).rejects.toThrow("closed");
  await s.settled();
});

it("每任务持有者和任务总数有界，重复保留不占额外容量", async () => {
  const { subscriptions: s, provider } = setup();
  for (let i = 0; i < 64; i++) await s.retain(provider, "p", "t", String(i));
  await s.retain(provider, "p", "t", "0");
  await expect(s.retain(provider, "p", "t", "overflow")).rejects.toThrow("capacity");
  for (let i = 1; i < 512; i++) await s.retain(provider, "p", String(i), "view");
  await expect(s.retain(provider, "p", "overflow", "view")).rejects.toThrow("capacity");
  await s.release("p", "1", "view");
  await s.retain(provider, "p", "replacement", "view");
});

it("目录读取期间删除任务，旧保留请求不能复活已删除的订阅", async () => {
  const { subscriptions: s, provider, unsubscribeTask, readTaskMetadata } = setup();
  const reading = Promise.withResolvers<{ id: string }>();
  readTaskMetadata.mockReturnValueOnce(reading.promise);
  const retain = s.retain(provider, "p", "t", "view");
  await vi.waitFor(() => {
    expect(readTaskMetadata).toHaveBeenCalledOnce();
  });
  s.forget("p", "t");
  reading.resolve({ id: "t" });
  await retain;
  await s.release("p", "t", "view");
  expect(unsubscribeTask).not.toHaveBeenCalled();
});
