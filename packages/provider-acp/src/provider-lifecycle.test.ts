import { expect, it, vi } from "vitest";
import type { AgentCapabilities } from "@agentclientprotocol/sdk/unstable";
import { fixture, input } from "./provider.test-support.js";

const engine = "acp-test";

it("本地已有完整历史时用 resume 恢复原会话，不重放历史", async () => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} } },
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  const saved = await f.history.read(task.id);
  expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
  await f.provider.readSessionState(task.id);
  expect(f.resumed).toHaveBeenCalledOnce();
  expect(f.resumed.mock.calls[0]?.[0].params).toMatchObject({
    sessionId: "native",
    mcpServers: [],
  });
  expect(f.loaded).not.toHaveBeenCalled();
  expect(await f.history.read(task.id)).toEqual(saved);
});

it.each([true, false])("本地缺少历史时按已协商能力恢复（load=%s）", async (loadSession) => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession, sessionCapabilities: { resume: {} } },
  });
  const task = await f.provider.startTask();
  const stored = f.tasks.get(task.id);
  if (!stored) throw new Error("缺少测试任务");
  stored.sessionId = "existing";
  const snapshot = await f.provider.readTask(task.id);
  if (loadSession) {
    expect(f.loaded).toHaveBeenCalledOnce();
    expect(f.resumed).not.toHaveBeenCalled();
    expect(snapshot.turns).toHaveLength(1);
  } else {
    expect(f.resumed).toHaveBeenCalledOnce();
    expect(f.loaded).not.toHaveBeenCalled();
    expect(snapshot.turns).toEqual([]);
    await f.provider.startConfiguredTurn(task.id, input);
    await vi.waitFor(async () => {
      expect(await f.history.hasTurns(task.id)).toBe(true);
    });
  }
  expect(f.created).not.toHaveBeenCalled();
});

it("无 close 时不发送关闭请求，暖连接重开沿用绑定，空闲后回收", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const f = await fixture(engine, undefined, undefined, {
      capabilities: { sessionCapabilities: { resume: {} } },
    });
    const task = await f.provider.startTask();
    await f.provider.readSessionState(task.id);
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    expect(await f.provider.unsubscribeTask(task.id)).toBe("notLoaded");
    await f.provider.readSessionState(task.id);
    expect(f.resumed).not.toHaveBeenCalled();
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    await vi.advanceTimersByTimeAsync(30_000);
    await f.provider.readSessionState(task.id);
    expect(f.connected).toHaveBeenCalledTimes(2);
    expect(f.resumed).toHaveBeenCalledOnce();
    expect(f.created).toHaveBeenCalledOnce();
    expect(f.closed).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("仅 resume 期间新写入的回合不能掩盖旧历史缺口", async () => {
  const capabilities: AgentCapabilities = { sessionCapabilities: { resume: {} } };
  const f = await fixture(engine, undefined, undefined, { capabilities });
  const task = await f.provider.startTask();
  const stored = f.tasks.get(task.id);
  if (!stored) throw new Error("缺少测试任务");
  stored.sessionId = "existing";
  // 先用真实计时器等历史落盘，再模拟空闲时钟，避免依赖文件 I/O 时序。
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  expect(await f.history.hasTurns(task.id)).toBe(true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    capabilities.loadSession = true;
    await vi.advanceTimersByTimeAsync(30_000);
    await f.provider.readSessionState(task.id);
    expect(f.resumed).toHaveBeenCalledOnce();
    expect(f.loaded).toHaveBeenCalledOnce();
    expect(await f.history.hasCompleteHistory(task.id)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("回收未关闭会话的容量，不中断其他任务的回合", async () => {
  const prompt = Promise.withResolvers<{ stopReason: "end_turn" }>();
  const f = await fixture(engine, () => prompt.promise, undefined, {
    capabilities: { sessionCapabilities: { resume: {} } },
  });
  let next = 0;
  f.created.mockImplementation(() => ({ sessionId: String(++next) }));
  const running = await f.provider.startTask();
  try {
    await f.provider.startConfiguredTurn(running.id, input);
    for (let i = 0; i < 63; i++) {
      const task = await f.provider.startTask();
      await f.provider.readSessionState(task.id);
      expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    }
    expect(f.connected).toHaveBeenCalledOnce();
    expect(await f.provider.unsubscribeTask(running.id)).toBe("busy");
  } finally {
    prompt.resolve({ stopReason: "end_turn" });
  }
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(running.id)).toBe(false);
  });
  const nextTask = await f.provider.startTask();
  await f.provider.readSessionState(nextTask.id);
  await f.provider.readSessionState(running.id);
  expect(f.connected).toHaveBeenCalledTimes(2);
  expect(f.resumed).toHaveBeenCalledOnce();
  expect(f.closed).not.toHaveBeenCalled();
});
