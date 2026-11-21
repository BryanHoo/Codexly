import { expect, it, vi } from "vitest";
import { AcpHistoryCache } from "./history-cache.js";
import { fixture, input } from "./provider.test-support.js";

it("打开及运行的历史不会被另一宿主淘汰，退订后可回收并重新加载", async () => {
  const f = await fixture("acp-test");
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  const sweeper = new AcpHistoryCache(f.history.directory, undefined, 0);
  await sweeper.prune();
  expect(await f.history.hasTurns(task.id)).toBe(true);
  await f.provider.unsubscribeTask(task.id);
  await sweeper.prune();
  expect(await f.history.hasTurns(task.id)).toBe(false);
  expect((await f.provider.readTask(task.id)).turns[0]?.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "旧回答" })]),
  );
  expect(f.loaded).toHaveBeenCalledOnce();
});

it("暖会话的缓存被淘汰后必须 load，不能因已有会话绑定直接返回空历史", async () => {
  const f = await fixture("acp-test", undefined, undefined, {
    capabilities: { session: {} },
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  await f.provider.unsubscribeTask(task.id);
  await new AcpHistoryCache(f.history.directory, undefined, 0).prune();
  expect((await f.provider.readTask(task.id)).turns).toHaveLength(1);
  expect(f.loaded).toHaveBeenCalledOnce();
  expect(f.resumed).not.toHaveBeenCalled();
});
