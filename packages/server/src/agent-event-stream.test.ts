import { Buffer } from "node:buffer";

import type { AgentEvent } from "@code-agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentEventStream } from "./agent-event-stream.js";
import { getSerializedAgentEventByteLength } from "./event-socket-sender.js";

const deltaEvent = {
  itemId: "item-1",
  payload: { delta: "实时" },
  taskId: "task-1",
  turnId: "turn-1",
  type: "message.delta",
} as const;

const fixedTimestamp = "2026-07-23T00:00:00.000Z";

function publishedEventBytes(delta: string, sequence = 1): number {
  return Buffer.byteLength(
    JSON.stringify({
      ...deltaEvent,
      payload: { delta },
      provider: "codex",
      sequence,
      sessionId: "runtime-1",
      timestamp: fixedTimestamp,
      version: 2,
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentEventStream", () => {
  it("reuses the serialized event size retained by the stream", () => {
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const stringify = vi.spyOn(JSON, "stringify");
    const callsBefore = stringify.mock.calls.length;
    stream.subscribe((event) => {
      getSerializedAgentEventByteLength(event);
      getSerializedAgentEventByteLength(event);
    });

    stream.publish(deltaEvent);
    expect(stream.checkpoint.sequence).toBe(1);

    expect(stringify.mock.calls.length - callsBefore).toBe(1);
    stream.close();
  });

  it("publishes the first delta immediately and coalesces subsequent deltas", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      now: () => new Date("2026-07-23T00:00:00.000Z"),
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish(deltaEvent);
    expect(listener).toHaveBeenCalledOnce();
    stream.publish({ ...deltaEvent, payload: { delta: "更新" } });
    stream.publish({ ...deltaEvent, payload: { delta: "完成" } });

    expect(listener).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15);
    expect(listener).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      {
        ...deltaEvent,
        provider: "codex",
        sequence: 1,
        sessionId: "runtime-1",
        timestamp: "2026-07-23T00:00:00.000Z",
        version: 2,
      },
      {
        ...deltaEvent,
        payload: { delta: "更新完成" },
        provider: "codex",
        sequence: 2,
        sessionId: "runtime-1",
        timestamp: "2026-07-23T00:00:00.000Z",
        version: 2,
      },
    ]);
    expect(stream.metrics).toEqual({
      backpressureSignals: 0,
      coalescedEvents: 1,
      pendingDeltas: 0,
      providerEventsReceived: 3,
      publishedEvents: 2,
      retainedEvents: 2,
      retentionEvictions: 0,
    });
  });

  it("merges only adjacent deltas with the same item key", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish({ ...deltaEvent, itemId: "item-a", payload: { delta: "A1" } });
    stream.publish({ ...deltaEvent, itemId: "item-b", payload: { delta: "B1" } });
    stream.publish({ ...deltaEvent, itemId: "item-a", payload: { delta: "A2" } });
    vi.advanceTimersByTime(16);

    expect(listener.mock.calls.map(([event]) => event)).toMatchObject([
      { itemId: "item-a", payload: { delta: "A1" }, sequence: 1 },
      { itemId: "item-b", payload: { delta: "B1" }, sequence: 2 },
      { itemId: "item-a", payload: { delta: "A2" }, sequence: 3 },
    ]);
    expect(stream.metrics).toMatchObject({ coalescedEvents: 0, pendingDeltas: 0 });
  });

  it("coalesces plan text by appending and file patches by replacing", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish({
      ...deltaEvent,
      itemId: "plan-1",
      payload: { delta: "第一" },
      type: "plan.delta",
    });
    stream.publish({
      ...deltaEvent,
      itemId: "plan-1",
      payload: { delta: "第二" },
      type: "plan.delta",
    });
    stream.publish({
      itemId: "patch-1",
      payload: {
        changes: [{ diff: "old diff", kind: "update", path: "src/app.ts" }],
        originalByteLength: 8,
        truncated: false,
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "file_change.updated",
    });
    stream.publish({
      itemId: "patch-1",
      payload: {
        changes: [{ diff: "latest diff", kind: "update", path: "src/app.ts" }],
        originalByteLength: 11,
        truncated: false,
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "file_change.updated",
    });
    vi.advanceTimersByTime(16);

    expect(listener.mock.calls.map(([event]) => event)).toMatchObject([
      { payload: { delta: "第一" }, sequence: 1, type: "plan.delta" },
      { payload: { delta: "第二" }, sequence: 2, type: "plan.delta" },
      {
        payload: { changes: [{ diff: "latest diff" }] },
        sequence: 3,
        type: "file_change.updated",
      },
    ]);
  });

  it("keeps reasoning summary sections in separate ordered events", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish({
      ...deltaEvent,
      itemId: "reasoning-1",
      payload: { delta: "第一段", field: "summary", sectionIndex: 0 },
      type: "reasoning.delta",
    });
    stream.publish({
      ...deltaEvent,
      itemId: "reasoning-1",
      payload: { delta: "第二段", field: "summary", sectionIndex: 1 },
      type: "reasoning.delta",
    });
    vi.advanceTimersByTime(16);

    expect(listener.mock.calls.map(([event]) => event)).toMatchObject([
      { payload: { delta: "第一段", sectionIndex: 0 }, sequence: 1 },
      { payload: { delta: "第二段", sectionIndex: 1 }, sequence: 2 },
    ]);
  });

  it("publishes the first delta immediately and uses pressure window for the trailing batch", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.noteBackpressure();
    stream.publish(deltaEvent);
    expect(listener).toHaveBeenCalledOnce();
    stream.publish({ ...deltaEvent, payload: { delta: "后续" } });
    vi.advanceTimersByTime(31);
    expect(listener).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(stream.metrics.backpressureSignals).toBe(1);
  });

  it("keeps reasoning fields separate and flushes deltas before terminal events", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({ provider: "codex", sessionId: "runtime-1" });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);
    const reasoningDelta = {
      itemId: "reasoning-1",
      payload: { delta: "摘要", field: "summary" as const },
      taskId: "task-1",
      turnId: "turn-1",
      type: "reasoning.delta" as const,
    };

    stream.publish(reasoningDelta);
    stream.publish({
      ...reasoningDelta,
      payload: { delta: "正文", field: "content" },
    });
    stream.publish({
      itemId: "reasoning-1",
      payload: {
        item: { content: "正文", id: "reasoning-1", summary: "完成", type: "reasoning" },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([event]) => event)).toMatchObject([
      { payload: { delta: "摘要", field: "summary" }, sequence: 1 },
      { payload: { delta: "正文", field: "content" }, sequence: 2 },
      { sequence: 3, type: "item.completed" },
    ]);
  });

  it("flushes pending deltas at checkpoint and stops publishing after unsubscribe", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      capacity: 3,
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    const unsubscribe = stream.subscribe(listener);

    stream.publish(deltaEvent);
    expect(stream.checkpoint).toEqual({ sequence: 1, sessionId: "runtime-1" });
    unsubscribe();
    stream.publish({ ...deltaEvent, payload: { delta: "取消后" } });
    vi.advanceTimersByTime(16);

    expect(listener).toHaveBeenCalledOnce();
    expect(stream.checkpoint).toEqual({ sequence: 2, sessionId: "runtime-1" });
  });

  it("replays ring-buffered events and requires resync outside the bounded window", () => {
    vi.useFakeTimers();
    const stream = new AgentEventStream({
      capacity: 2,
      provider: "codex",
      sessionId: "runtime-1",
    });
    stream.publish({ ...deltaEvent, itemId: "item-1", payload: { delta: "1" } });
    vi.advanceTimersByTime(16);
    stream.publish({ ...deltaEvent, itemId: "item-2", payload: { delta: "2" } });
    vi.advanceTimersByTime(16);
    stream.publish({ ...deltaEvent, itemId: "item-3", payload: { delta: "3" } });

    expect(stream.replayAfter(1)).toMatchObject({
      events: [{ sequence: 2 }, { sequence: 3 }],
      type: "events",
    });
    expect(stream.replayAfter(0)).toEqual({
      latestSequence: 3,
      reason: "event_retention_exceeded",
      type: "resync",
    });
    expect(stream.replayAfter(4)).toEqual({
      latestSequence: 3,
      reason: "session_changed",
      type: "resync",
    });
    expect(stream.metrics).toMatchObject({ retainedEvents: 2, retentionEvictions: 1 });
  });

  it("evicts oldest events until the retained history fits the byte budget", () => {
    vi.useFakeTimers();
    const delta = "你".repeat(20);
    const eventBytes = publishedEventBytes(delta);
    const stream = new AgentEventStream({
      maxEventBytes: eventBytes,
      maxRetainedBytes: eventBytes * 2 - 1,
      now: () => new Date(fixedTimestamp),
      provider: "codex",
      sessionId: "runtime-1",
    });

    stream.publish({ ...deltaEvent, itemId: "item-1", payload: { delta } });
    vi.advanceTimersByTime(16);
    stream.publish({ ...deltaEvent, itemId: "item-2", payload: { delta } });
    vi.advanceTimersByTime(16);

    expect(stream.replayAfter(0)).toEqual({
      latestSequence: 2,
      reason: "event_retention_exceeded",
      type: "resync",
    });
    expect(stream.replayAfter(1)).toMatchObject({
      events: [{ itemId: "item-2", sequence: 2 }],
      type: "events",
    });
    expect(stream.metrics).toMatchObject({ retainedEvents: 1, retentionEvictions: 1 });
  });

  it("does not retain an oversized event and requires resync across its sequence", () => {
    vi.useFakeTimers();
    const delta = "大".repeat(20);
    const eventBytes = publishedEventBytes(delta);
    const stream = new AgentEventStream({
      maxEventBytes: eventBytes - 1,
      maxRetainedBytes: eventBytes * 2,
      now: () => new Date(fixedTimestamp),
      provider: "codex",
      sessionId: "runtime-1",
    });
    const listener = vi.fn<(event: AgentEvent) => void>();
    stream.subscribe(listener);

    stream.publish({ ...deltaEvent, payload: { delta } });
    vi.advanceTimersByTime(16);

    expect(listener).toHaveBeenCalledOnce();
    expect(stream.replayAfter(0)).toEqual({
      latestSequence: 1,
      reason: "event_retention_exceeded",
      type: "resync",
    });
    expect(stream.replayAfter(1)).toEqual({ events: [], type: "events" });
    expect(stream.metrics).toMatchObject({ retainedEvents: 0, retentionEvictions: 1 });
  });
});
