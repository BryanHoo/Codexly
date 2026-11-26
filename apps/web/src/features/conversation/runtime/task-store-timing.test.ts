import type { AgentEvent, AgentItem, AgentTurn } from "@codexly/protocol";
import { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope, timestamp } from "./task-store.test-support.js";

it("文本速度按最近五秒的累计增量和实际时长计算", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
  const now = Date.parse(timestamp);
  const state = store.getState();
  const rates = new TurnOutputRates();
  state.turnOutputRates.current = rates;
  const turnId = "turn-running";
  const reply = {
    ...eventEnvelope(11),
    turnId,
    itemId: "message-running",
    type: "message.delta",
    payload: { delta: "思考中。".repeat(10) },
  } as const;
  const at = (elapsed: number) => new Date(now + elapsed).toISOString();

  expect(rates.read(turnId)).toBeNull();
  state.applyEvents([{ ...reply, timestamp: at(0), payload: { delta: "x".repeat(1_400) } }]);
  expect(rates.read(turnId)).toBeNull();
  // 同一客户端批次中，中文按 Codex 的字节计量，以服务端事件间隔重算。
  state.applyEvents([
    { ...reply, sequence: 12, timestamp: at(20), payload: { delta: "首批缓存".repeat(25) } },
    { ...reply, sequence: 13, timestamp: at(500), payload: { delta: "思考中。".repeat(5) } },
    { ...reply, sequence: 13 },
    { ...reply, sequence: 14, type: "command.output_delta", itemId: "terminal" },
    { ...reply, sequence: 15, turnId: "turn-completed", itemId: "message-completed" },
    { ...reply, sequence: 16, itemId: "acp:child:other:acp:message:assistant:reply" },
    { ...reply, sequence: 17, itemId: "acp:message:user:echo" },
  ]);
  expect(rates.read(turnId)).toBe(30);
  state.applyEvents([
    { ...reply, sequence: 18, timestamp: at(1_000), payload: { delta: "思考中。".repeat(5) } },
  ]);
  expect(rates.read(turnId)).toBe(30);
  state.applyEvents([
    { ...reply, sequence: 19, timestamp: at(2_000), payload: { delta: "x".repeat(1_400) } },
  ]);
  expect(rates.read(turnId)).toBe(190);
  state.applyEvents([{ ...reply, sequence: 20, timestamp: at(3_000) }]);
  expect(rates.read(turnId)).toBeCloseTo(410 / 3);
  state.applyEvents([
    { ...reply, sequence: 21, timestamp: at(5_000) },
    { ...reply, sequence: 22, timestamp: at(7_500) },
  ]);
  // 五秒窗口只计入 2–3 秒这段的后半部分。
  expect(rates.read(turnId)).toBe(15);

  // 同一会话的快照和长时间的工具执行期间保留已有读数，继续输出时重新测量。
  state.reconcile({ ...createResponse(), checkpoint: { sessionId: "session-1", sequence: 22 } });
  expect(rates.read(turnId)).toBe(15);
  state.applyEvents([{ ...reply, sequence: 23, timestamp: at(11_000) }]);
  expect(rates.read(turnId)).toBe(15);
  state.applyEvents([
    { ...reply, sequence: 24, timestamp: at(12_000), payload: { delta: "🧠".repeat(40) } },
  ]);
  expect(rates.read(turnId)).toBe(40);
  state.hydrate(createResponse());
  expect(rates.read(turnId)).toBeNull();
});

it("短回复在 302ms 的真实推送节奏下即可显示速度", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
  const start = Date.parse(timestamp);
  const state = store.getState();
  const rates = new TurnOutputRates();
  state.turnOutputRates.current = rates;
  const turnId = "turn-running";

  // 复用真实 WebSocket 的分块大小和时间。单批没有时间差，后续增量形成读数。
  const arrivals = [
    [0, 3],
    [18, 36],
    [153, 3],
    [171, 114],
    [171, 3],
    [188, 21],
    [191, 6],
    [207, 42],
    [212, 3],
    [234, 21],
    [242, 3],
    [258, 3],
    [261, 3],
    [283, 21],
    [283, 3],
    [302, 3],
  ] as const;
  for (const [index, [elapsed, bytes]] of arrivals.entries()) {
    state.applyEvents([
      {
        ...eventEnvelope(11 + index),
        turnId,
        itemId: "message-running",
        timestamp: new Date(start + elapsed).toISOString(),
        type: "message.delta",
        payload: { delta: "字".repeat(bytes / 3) },
      },
    ]);
    if (elapsed < 100) expect(rates.read(turnId)).toBeNull();
    if (elapsed === 153) expect(rates.read(turnId)).toBeCloseTo(1_000 / 153);
  }
  expect(rates.read(turnId)).toBeCloseTo(55_000 / 258);
});

it("速率优先使用 ACP 上报差值，计数重置时使用独立的文本估算", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
  const start = Date.parse(timestamp);
  const state = store.getState();
  const rates = new TurnOutputRates();
  state.turnOutputRates.current = rates;
  const turnId = "turn-running";
  const send = (deltaMs: number, event: AgentEvent) => {
    state.applyEvents([{ ...event, timestamp: new Date(start + deltaMs).toISOString() }]);
  };
  const usage = (sequence: number, outputTokens?: number): AgentEvent => ({
    ...eventEnvelope(sequence),
    provider: "acp-any-agent",
    turnId,
    type: "usage.updated",
    payload: {
      usage: { usedTokens: 5000, contextWindow: 10000 },
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
  });
  const reply = (sequence: number): Extract<AgentEvent, { type: "message.delta" }> => ({
    ...eventEnvelope(sequence),
    provider: "acp-any-agent",
    turnId,
    itemId: "message-running",
    type: "message.delta",
    payload: { delta: "text".repeat(40) },
  });
  const rate = () => rates.read(turnId);
  send(0, usage(11, 100));
  expect(rate()).toBeNull();
  send(100, usage(12, 160));
  expect(rate()).toBe(600);
  send(100, reply(13));
  send(600, { ...reply(14), payload: { delta: "text".repeat(20) } });
  expect(rate()).toBe(600);
  send(1_100, { ...reply(15), payload: { delta: "text".repeat(20) } });
  expect(rate()).toBe(600);
  send(2_000, usage(16, 300));
  expect(rate()).toBe(100);
  send(4_000, usage(18, 300));
  expect(rate()).toBe(100);
  send(5_000, usage(19, 450));
  expect(rate()).toBe(70);
  send(5_250, usage(20, 0));
  expect(rate()).toBe(40);
  send(6_250, usage(21, 120));
  expect(rate()).toBe(120);
  send(8_000, reply(22));
  send(10_000, reply(23));
  expect(rate()).toBe(120);
  send(12_000, reply(24));
  expect(rate()).toBe(20);
});

describe("streamed tool timing", () => {
  it("records file changes but does not invent reasoning timing", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const file: Extract<AgentItem, { type: "file_change" }> = {
      id: "files-1",
      changes: [],
      status: "running",
      type: "file_change",
    };
    const reasoning = {
      id: "reasoning-1",
      content: "",
      summary: "思考",
      type: "reasoning",
    } as const;
    for (const [sequence, type, item] of [
      [11, "item.started", file],
      [12, "item.completed", { ...file, status: "completed" }],
      [13, "item.completed", reasoning],
    ] as const) {
      store.getState().applyEvents([
        {
          ...eventEnvelope(sequence),
          itemId: item.id,
          payload: { item },
          timestamp: sequence === 11 ? "2026-07-28T00:00:01.000Z" : "2026-07-28T00:00:03.500Z",
          turnId: "turn-running",
          type,
        },
      ]);
    }
    expect(store.getState().turnsById["turn-running"]?.itemTimings).toEqual({
      [file.id]: {
        startedAtMs: Date.parse("2026-07-28T00:00:01.000Z"),
        completedAtMs: Date.parse("2026-07-28T00:00:03.500Z"),
      },
    });
  });
  it("records tool events before the turn completes and retains them afterward", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const item = { id: "tool-1", name: "read_file", status: "running", type: "tool" } as const;
    const startedAt = "2026-07-28T00:00:01.000Z";
    const completedAt = "2026-07-28T00:00:03.500Z";

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: item.id,
        payload: { item },
        timestamp: startedAt,
        turnId: "turn-running",
        type: "item.started",
      },
    ]);
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
    });

    store.getState().applyEvents([
      {
        ...eventEnvelope(12),
        itemId: item.id,
        payload: { item: { ...item, status: "completed" } },
        timestamp: completedAt,
        turnId: "turn-running",
        type: "item.completed",
      },
    ]);
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });

    const terminalTurn: AgentTurn = {
      completedAt,
      error: null,
      id: "turn-running",
      itemTimings: { [item.id]: { completedAtMs: Date.parse(completedAt) } },
      items: [{ ...item, status: "completed" }],
      startedAt: timestamp,
      status: "completed",
    };
    store.getState().applyEvents([
      {
        ...eventEnvelope(13),
        payload: { turn: terminalTurn },
        timestamp: completedAt,
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);
    expect(store.getState().reconstructSnapshot()?.turns[1]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });

    store.getState().reconcile({
      ...createResponse(),
      checkpoint: { sequence: 14, sessionId: "session-1" },
    });
    expect(store.getState().turnsById["turn-running"]?.itemTimings?.[item.id]).toEqual({
      startedAtMs: Date.parse(startedAt),
      completedAtMs: Date.parse(completedAt),
    });
  });
});
