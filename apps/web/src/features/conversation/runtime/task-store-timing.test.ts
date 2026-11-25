import type { AgentEvent, AgentItem, AgentTurn } from "@codexly/protocol";
import { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";
import { createResponse, eventEnvelope, timestamp } from "./task-store.test-support.js";

it("首批前台输出即估算速度，再按实际间隔采样并保留暂停前的读数", () => {
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
  // 同一客户端批次中，中文按 Codex 的字节计量，以服务端事件间隔重算。
  state.applyEvents([
    { ...reply, timestamp: at(0) },
    { ...reply, sequence: 12, timestamp: at(20), payload: { delta: "首批缓存".repeat(25) } },
    { ...reply, sequence: 13, timestamp: at(1_000) },
    { ...reply, sequence: 13 },
    { ...reply, sequence: 14, type: "command.output_delta", itemId: "terminal" },
    { ...reply, sequence: 15, turnId: "turn-completed", itemId: "message-completed" },
    { ...reply, sequence: 16, itemId: "acp:child:other:acp:message:assistant:reply" },
    { ...reply, sequence: 17, itemId: "acp:message:user:echo" },
  ]);
  expect(rates.read(turnId)).toBe(30);

  // 同一会话的快照和长时间的工具执行期间保留已有读数，继续输出时重新测量。
  state.reconcile({ ...createResponse(), checkpoint: { sessionId: "session-1", sequence: 17 } });
  expect(rates.read(turnId)).toBe(30);
  state.applyEvents([{ ...reply, sequence: 18, timestamp: at(10_000) }]);
  expect(rates.read(turnId)).toBe(30);
  state.applyEvents([
    { ...reply, sequence: 19, timestamp: at(11_000), payload: { delta: "🧠".repeat(40) } },
  ]);
  expect(rates.read(turnId)).toBe(40);
  state.hydrate(createResponse());
  expect(rates.read(turnId)).toBeNull();
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
  const reply = (sequence: number): AgentEvent => ({
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
  expect(rate()).toBeNull();
  send(100, reply(13));
  send(1_100, reply(14));
  send(1_100, usage(15));
  expect(rate()).toBe(40);
  send(2_000, usage(16, 300));
  expect(rate()).toBe(100);
  send(4_000, usage(17, 300));
  expect(rate()).toBe(100);
  send(5_000, usage(18, 450));
  expect(rate()).toBe(50);
  send(5_250, usage(19, 0));
  expect(rate()).toBe(40);
  send(6_250, usage(20, 120));
  expect(rate()).toBe(120);
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
