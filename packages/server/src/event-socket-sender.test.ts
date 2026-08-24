import type { AgentEvent } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSerializedAgentEventByteLength,
  sendEventStreamEvents,
  type EventStreamSocket,
} from "./event-socket-sender.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createSocket(): Omit<EventStreamSocket, "send"> & {
  send: ReturnType<typeof vi.fn<(data: string) => void>>;
} {
  return {
    bufferedAmount: 0,
    close: vi.fn(),
    readyState: 1,
    send: vi.fn<(data: string) => void>(),
  };
}

function createLargeEvent(): AgentEvent {
  const diff = "diff".repeat(128 * 1_024);
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

describe("event socket sender", () => {
  it("serializes a retained event once across multiple WebSocket clients", () => {
    const event = createLargeEvent();
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
});
