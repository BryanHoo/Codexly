import type { AgentEvent } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSerializedAgentEventByteLength,
  sendEventStreamEvents,
  sendEventStreamMessage,
  type EventStreamSocket,
} from "./event-socket-sender.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createSocket(): Omit<EventStreamSocket, "send" | "bufferedAmount" | "readyState"> & {
  bufferedAmount: number;
  readyState: number;
  send: ReturnType<typeof vi.fn<(data: string) => void>>;
} {
  return {
    bufferedAmount: 0,
    close: vi.fn(),
    readyState: 1,
    send: vi.fn<(data: string) => void>(),
  };
}

function createLargeEvent(
  diffBytes = 512 * 1_024,
): Extract<AgentEvent, { type: "file_change.updated" }> {
  const diff = "diff".repeat(diffBytes / 4);
  return {
    itemId: "file-change-serialization",
    payload: {
      changes: [{ diff, kind: "update", path: "src/large.ts" }],
      originalByteLength: Buffer.byteLength(diff),
      truncated: false,
    },
    provider: "codex",
    sequence: 1,
    sessionId: "session-serialization",
    taskId: "task-serialization",
    timestamp: "2026-08-23T00:00:00.000Z",
    turnId: "turn-serialization",
    type: "file_change.updated",
    version: 2,
  };
}

function createDeltaEvent(delta: string, sequence = 1): AgentEvent {
  return { ...createLargeEvent(0), sequence, type: "message.delta", payload: { delta } };
}

describe("event socket sender", () => {
  it.each(["x", "中", "\n", "😀"])("splits 64 large events by UTF-8 bytes (%j)", (character) => {
    const socket = createSocket();
    const events = Array.from({ length: 64 }, (_, index) =>
      createDeltaEvent(character.repeat(100 * 1_024), index + 1),
    );

    expect(sendEventStreamEvents(socket, events, vi.fn(), vi.fn())).toBe(true);
    expect(socket.send.mock.calls.length).toBeGreaterThan(1);
    for (const [data] of socket.send.mock.calls) {
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(1_024 * 1_024);
      expect((JSON.parse(data) as { events: AgentEvent[] }).events.length).toBeLessThanOrEqual(64);
    }
    expect(
      socket.send.mock.calls.flatMap(
        ([data]) => (JSON.parse(data) as { events: AgentEvent[] }).events,
      ),
    ).toEqual(events);
  });

  it("rejects a single oversized event even when the socket buffer is empty", () => {
    const socket = createSocket();
    const event = createLargeEvent();
    const onSlowClientDisconnect = vi.fn();

    expect(sendEventStreamEvents(socket, [event], vi.fn(), onSlowClientDisconnect)).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(
      1009,
      "Event frame is too large; refresh the snapshot",
    );
    expect(onSlowClientDisconnect).not.toHaveBeenCalled();
  });

  it("checks the next frame against the hard budget and accepts its exact boundary", () => {
    const event = createDeltaEvent("x");
    const frame = { events: [event], type: "events.batch" as const, version: 3 as const };
    const frameBytes = Buffer.byteLength(JSON.stringify(frame));
    const socket = createSocket();
    const onSlowClientDisconnect = vi.fn();
    socket.bufferedAmount = 1_024 * 1_024 - frameBytes;

    expect(sendEventStreamMessage(socket, frame, vi.fn(), onSlowClientDisconnect)).toBe(true);
    socket.bufferedAmount += 1;
    expect(sendEventStreamMessage(socket, frame, vi.fn(), onSlowClientDisconnect)).toBe(false);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(onSlowClientDisconnect).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(1013, "Client is too slow; refresh the snapshot");
  });

  it("stops later batches when sends accumulate beyond the hard budget", () => {
    const socket = createSocket();
    socket.send.mockImplementation((data) => {
      socket.bufferedAmount += Buffer.byteLength(data);
    });
    const events = Array.from({ length: 64 }, (_, index) =>
      createDeltaEvent("x".repeat(100 * 1_024), index + 1),
    );

    expect(sendEventStreamEvents(socket, events, vi.fn(), vi.fn())).toBe(false);
    expect(socket.bufferedAmount).toBeLessThanOrEqual(1_024 * 1_024);
    expect(socket.send).toHaveBeenCalledOnce();
  });

  it("signals soft pressure using the projected buffered amount", () => {
    const socket = createSocket();
    socket.bufferedAmount = 256 * 1_024;
    const onSoftBackpressure = vi.fn();
    expect(
      sendEventStreamMessage(
        socket,
        {
          latestSequence: 0,
          sessionId: "session",
          type: "connection.ready",
          version: 3,
        },
        onSoftBackpressure,
        vi.fn(),
      ),
    ).toBe(true);
    expect(onSoftBackpressure).toHaveBeenCalledOnce();
  });

  it.each([1, 3])(
    "rejects oversized messages through the generic message sender too (%i events)",
    (count) => {
      const socket = createSocket();
      expect(
        sendEventStreamMessage(
          socket,
          {
            events: Array.from({ length: count }, () => createLargeEvent()),
            type: "events.batch",
            version: 3,
          },
          vi.fn(),
          vi.fn(),
        ),
      ).toBe(false);
      expect(socket.send).not.toHaveBeenCalled();
    },
  );

  it("serializes a retained event once across multiple WebSocket clients", () => {
    const event = createLargeEvent(256 * 1_024);
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const stringify = vi.spyOn(JSON, "stringify");

    getSerializedAgentEventByteLength(event);
    expect(sendEventStreamEvents(firstSocket, [event], vi.fn(), vi.fn())).toBe(true);
    expect(sendEventStreamEvents(secondSocket, [event], vi.fn(), vi.fn())).toBe(true);

    expect(stringify).toHaveBeenCalledTimes(1);
    expect(firstSocket.send).toHaveBeenCalledOnce();
    expect(secondSocket.send).toHaveBeenCalledOnce();
    expect(firstSocket.send.mock.calls[0]?.[0]).toBe(secondSocket.send.mock.calls[0]?.[0]);
  });

  it("accepts the exact single-event budget and rejects one extra byte", () => {
    const overhead = getSerializedAgentEventByteLength(createDeltaEvent(""));
    const socket = createSocket();
    const delta = "x".repeat(512 * 1_024 - overhead);
    expect(sendEventStreamEvents(socket, [createDeltaEvent(delta)], vi.fn(), vi.fn())).toBe(true);
    expect(sendEventStreamEvents(socket, [createDeltaEvent(delta + "x")], vi.fn(), vi.fn())).toBe(
      false,
    );
    expect(socket.send).toHaveBeenCalledOnce();
  });

  it("delivers a valid prefix and closes at an oversized event without skipping it", () => {
    const socket = createSocket();
    const first = createDeltaEvent("first", 1);
    const oversized = createDeltaEvent("x".repeat(512 * 1_024), 2);
    const last = createDeltaEvent("last", 3);
    expect(sendEventStreamEvents(socket, [first, oversized, last], vi.fn(), vi.fn())).toBe(false);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(
      (JSON.parse(socket.send.mock.calls[0]?.[0] ?? "") as { events: AgentEvent[] }).events,
    ).toEqual([first]);
  });

  it("does not serialize events for a closed socket or one already above the hard limit", () => {
    const event = createDeltaEvent("unused");
    const socket = createSocket();
    const stringify = vi.spyOn(JSON, "stringify");
    socket.readyState = 3;
    expect(sendEventStreamEvents(socket, [event], vi.fn(), vi.fn())).toBe(false);
    socket.readyState = 1;
    socket.bufferedAmount = 1_024 * 1_024 + 1;
    expect(sendEventStreamEvents(socket, [event], vi.fn(), vi.fn())).toBe(false);
    expect(stringify.mock.calls.length).toBe(0);
    expect(socket.send).not.toHaveBeenCalled();
  });
});
