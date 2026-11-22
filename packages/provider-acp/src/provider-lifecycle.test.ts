import { expect, it, vi } from "vitest";
import { readdir, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentCapabilities } from "@agentclientprotocol/sdk/unstable";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { fixture, input } from "./provider.test-support.js";

const engine = "acp-test";

it.each(["reopen", "restart"] as const)("历史任务 %s 后保留审核和快速模式选择", async (action) => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
    persistConfiguration: true,
  });
  const options = [
    { id: "approval", name: "审核", type: "boolean" as const, currentValue: true },
    { id: "fast", name: "快速模式", type: "boolean" as const, currentValue: false },
  ];
  f.created.mockReturnValue({ sessionId: "native", configOptions: options });
  let current = structuredClone(options);
  const set = vi.fn(({ params }: acp.AgentRequestContext<acp.SetSessionConfigOptionRequest>) => {
    current = current.map((option) =>
      option.id === params.configId ? { ...option, currentValue: params.value as boolean } : option,
    );
    return { configOptions: current };
  });
  f.app.onRequest(acp.methods.agent.session.setConfigOption, set);
  f.resumed.mockImplementation(() => {
    current = structuredClone(options);
    return { configOptions: current };
  });
  const task = await f.provider.startTask();
  await f.provider.setSessionConfiguration(task.id, "approval", false);
  await f.provider.setSessionConfiguration(task.id, "fast", true);
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  await f.provider.unsubscribeTask(task.id);
  const provider = action === "restart" ? await f.restart() : f.provider;
  const state = await provider.readSessionState(task.id);
  expect(f.resumed).toHaveBeenCalledOnce();
  expect(state.configOptions.map((option) => option.currentValue)).toEqual([false, true]);
});

it.each([{}])("普通退订保留不可恢复的会话（能力：%j）", async (capabilities) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const f = await fixture(engine, undefined, undefined, { capabilities });
    const task = await f.provider.startTask();
    await f.provider.readSessionState(task.id);
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    await vi.advanceTimersByTimeAsync(30_000);
    await f.provider.readSessionState(task.id);
    expect(f.connected).toHaveBeenCalledOnce();
    expect(f.closed).not.toHaveBeenCalled();
    expect(f.created).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["文件截断", "指针损坏"])("任务打开时从暖连接恢复当前历史：%s", async (damage) => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await vi.waitFor(() => {
    expect(f.provider.hasPendingTurn(task.id)).toBe(false);
  });
  const root = (await readdir(f.history.directory)).find((name) => /^[a-f0-9]{64}$/.test(name));
  if (!root) throw new Error("缺少历史目录");
  const path = join(f.history.directory, root);
  const generation = (await readdir(path)).find((name) => name.endsWith(".jsonl"));
  if (!generation) throw new Error("缺少历史文件");
  if (damage === "文件截断") await truncate(join(path, generation), 1);
  else await writeFile(join(path, "current"), "{");

  const snapshot = await f.provider.readTask(task.id);
  expect(snapshot.turns[0]?.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "旧回答" })]),
  );
  expect(f.loaded).toHaveBeenCalledOnce();
  expect(f.resumed).not.toHaveBeenCalled();
  expect(await f.history.hasCompleteHistory(task.id)).toBe(true);
});

it("本地已有完整历史时用 resume 恢复原会话，不重放历史", async () => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
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

it("本地缺少历史时请求完整重放", async () => {
  const f = await fixture(engine, undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
  });
  const task = await f.provider.startTask();
  const stored = f.tasks.get(task.id);
  if (!stored) throw new Error("缺少测试任务");
  stored.sessionId = "existing";
  const snapshot = await f.provider.readTask(task.id);
  {
    expect(f.loaded).toHaveBeenCalledOnce();
    expect(f.resumed).not.toHaveBeenCalled();
    expect(snapshot.turns).toHaveLength(1);
  }
  expect(f.created).not.toHaveBeenCalled();
});

it("退订关闭会话并保留原生会话身份", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const f = await fixture(engine, undefined, undefined, {
      capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
    });
    const task = await f.provider.startTask();
    await f.provider.readSessionState(task.id);
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    expect(await f.provider.unsubscribeTask(task.id)).toBe("notLoaded");
    await f.provider.readSessionState(task.id);
    expect(f.loaded).toHaveBeenCalledOnce();
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    await vi.advanceTimersByTimeAsync(30_000);
    await f.provider.readSessionState(task.id);
    expect(f.connected).toHaveBeenCalledOnce();
    expect(f.resumed).toHaveBeenCalledOnce();
    expect(f.created).toHaveBeenCalledOnce();
    expect(f.closed).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("仅 resume 期间新写入的回合不能掩盖旧历史缺口", async () => {
  const capabilities: AgentCapabilities = {
    loadSession: true,
    sessionCapabilities: { resume: {}, close: {}, list: {} },
  };
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
    capabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {}, list: {} } },
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
  expect(f.connected).toHaveBeenCalledOnce();
  expect(f.resumed).not.toHaveBeenCalled();
  expect(f.closed).toHaveBeenCalledTimes(63);
});

it("v1 未声明 close 时退订保留暖绑定，不重新 load 或消耗额外会话", async () => {
  const f = await fixture(engine, undefined, undefined, { capabilities: { loadSession: true } });
  const task = await f.provider.startTask();
  await f.provider.readSessionState(task.id);
  await f.provider.unsubscribeTask(task.id);
  await f.provider.readSessionState(task.id);
  expect(f.created).toHaveBeenCalledOnce();
  expect(f.loaded).not.toHaveBeenCalled();
  expect(f.closed).not.toHaveBeenCalled();
});

it("最小 v1 Agent 的临时生成连续超过容量时安全回收独占闲置连接", async () => {
  const f = await fixture(engine, undefined, undefined, { capabilities: {} });
  let sequence = 0;
  f.created.mockImplementation(() => ({
    sessionId: `temporary-${String(++sequence)}`,
    configOptions: [],
  }));
  for (let i = 0; i < 65; i++) {
    await expect(
      f.provider.generateText("生成", undefined, new AbortController().signal),
    ).resolves.toBe("ACP 回答");
  }
  expect(f.connected).toHaveBeenCalledTimes(2);
  expect(f.closed).not.toHaveBeenCalled();
});
