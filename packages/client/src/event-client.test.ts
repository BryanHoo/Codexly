import type { AgentEvent, ResyncRequired } from "@codexly/protocol";
import type * as TypeBoxValue from "@sinclair/typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";

const { checkSpy, decodeSpy } = vi.hoisted(() => ({
  checkSpy: vi.fn(),
  decodeSpy: vi.fn(),
}));

vi.mock("@sinclair/typebox/value", async (importOriginal) => {
  const original = await importOriginal<typeof TypeBoxValue>();
  return {
    ...original,
    Value: {
      ...original.Value,
      Check(...args: Parameters<typeof original.Value.Check>) {
        checkSpy();
        return original.Value.Check(...args);
      },
      Decode(...args: Parameters<typeof original.Value.Decode>) {
        decodeSpy();
        return original.Value.Decode(...args);
      },
    },
  };
});

function createCloseEvent(code: number): Event {
  const event = new Event("close");
  // Node 22 没有浏览器的 CloseEvent，全量测试仅需保留真实关闭事件的 code 语义。
  Object.defineProperty(event, "code", { enumerable: true, value: code });
  return event;
}

class FakeWebSocket extends EventTarget {
  public readonly url: string;
  public readyState: number = WebSocket.CONNECTING;

  public constructor(url: string) {
    super();
    this.url = url;
  }

  public close(code = 1000): void {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(createCloseEvent(code));
  }

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  public receive(message: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  public serverClose(code = 1006): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(createCloseEvent(code));
  }
}

function createHarness() {
  const sockets: FakeWebSocket[] = [];
  const client = new CodexlyClient({
    baseUrl: "http://127.0.0.1:3210/",
    webSocketFactory(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets };
}

const ready = {
  latestSequence: 3,
  sessionId: "runtime-1",
  type: "connection.ready",
  version: 3,
} as const;

function messageEvent(sequence: number, delta = "实时"): AgentEvent {
  return {
    itemId: "item-1",
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId: "task-1",
    timestamp: "2026-07-23T00:00:00.000Z",
    turnId: "turn-1",
    type: "message.delta",
    version: 2,
  };
}

function eventBatch(...events: AgentEvent[]) {
  return { events, type: "events.batch", version: 3 } as const;
}

afterEach(() => {
  vi.useRealTimers();
  checkSpy.mockClear();
  decodeSpy.mockClear();
});

describe("CodexlyClient realtime events", () => {
  it("connects temporary tasks through the public temporary event route", () => {
    const { client, sockets } = createHarness();

    const unsubscribe = client.subscribeEvents({
      afterSequence: 0,
      projectId: "temporary",
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });

    expect(sockets[0]?.url).toBe("ws://127.0.0.1:3210/v1/temporary/events?afterSequence=0");
    unsubscribe();
  });

  it("validates frames, ignores duplicates, and delivers consecutive events", () => {
    const { client, sockets } = createHarness();
    const events: AgentEvent[] = [];
    const states: string[] = [];

    const unsubscribe = client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onConnectionState: (state) => states.push(state),
      onEvent: (event) => events.push(event),
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });
    const socket = sockets[0];
    expect(socket?.url).toBe("ws://127.0.0.1:3210/v1/projects/codexly/events?afterSequence=3");
    socket?.open();
    socket?.receive(ready);
    socket?.receive(eventBatch(messageEvent(3, "重复"), messageEvent(4)));

    expect(events).toEqual([messageEvent(4)]);
    expect(states).toEqual(["connecting", "connected"]);
    unsubscribe();
    expect(socket?.readyState).toBe(WebSocket.CLOSED);
  });

  it("does not decode a frame again after schema validation", () => {
    const { client, sockets } = createHarness();
    const onEvent = vi.fn();
    client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onEvent,
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });
    sockets[0]?.open();
    sockets[0]?.receive(ready);
    checkSpy.mockClear();
    sockets[0]?.receive(eventBatch(messageEvent(4), messageEvent(5)));

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(checkSpy).toHaveBeenCalledOnce();
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it("turns sequence gaps and session changes into resync requests", () => {
    const gapHarness = createHarness();
    const gapResync: ResyncRequired[] = [];
    gapHarness.client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onEvent: vi.fn(),
      onResyncRequired: (message) => gapResync.push(message),
      sessionId: "runtime-1",
    });
    gapHarness.sockets[0]?.open();
    gapHarness.sockets[0]?.receive(ready);
    gapHarness.sockets[0]?.receive(eventBatch(messageEvent(5)));

    expect(gapResync).toEqual([
      {
        latestSequence: 5,
        reason: "sequence_gap",
        sessionId: "runtime-1",
        type: "resync.required",
        version: 3,
      },
    ]);

    const sessionHarness = createHarness();
    const sessionResync: ResyncRequired[] = [];
    sessionHarness.client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onEvent: vi.fn(),
      onResyncRequired: (message) => sessionResync.push(message),
      sessionId: "runtime-1",
    });
    sessionHarness.sockets[0]?.open();
    sessionHarness.sockets[0]?.receive({ ...ready, sessionId: "runtime-2" });

    expect(sessionResync[0]).toMatchObject({
      reason: "session_changed",
      sessionId: "runtime-2",
      type: "resync.required",
    });
  });

  it("forwards server resync frames and reports invalid messages", () => {
    const { client, sockets } = createHarness();
    const errors: Error[] = [];
    const resyncs: ResyncRequired[] = [];
    client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onError: (error) => errors.push(error),
      onEvent: vi.fn(),
      onResyncRequired: (message) => resyncs.push(message),
      sessionId: "runtime-1",
    });
    sockets[0]?.open();
    sockets[0]?.receive(ready);
    sockets[0]?.receive({
      latestSequence: 8,
      reason: "event_retention_exceeded",
      sessionId: "runtime-1",
      type: "resync.required",
      version: 3,
    });

    expect(resyncs[0]).toMatchObject({ reason: "event_retention_exceeded" });

    const invalidHarness = createHarness();
    invalidHarness.client.subscribeEvents({
      afterSequence: 0,
      projectId: "codexly",
      onError: (error) => errors.push(error),
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });
    invalidHarness.sockets[0]?.open();
    invalidHarness.sockets[0]?.receive({ native: true });
    expect(errors.at(-1)?.message).toContain("protocol schema");
  });

  it("reconnects from the latest sequence and cancellation clears pending retries", async () => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness();
    const states: string[] = [];
    const unsubscribe = client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onConnectionState: (state) => states.push(state),
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      reconnectDelayMs: 100,
      sessionId: "runtime-1",
    });
    sockets[0]?.open();
    sockets[0]?.receive(ready);
    sockets[0]?.receive(eventBatch(messageEvent(4)));
    sockets[0]?.serverClose();

    expect(states.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets[1]?.url).toBe("ws://127.0.0.1:3210/v1/projects/codexly/events?afterSequence=4");
    sockets[1]?.serverClose();
    unsubscribe();
    await vi.runAllTimersAsync();
    expect(sockets).toHaveLength(2);
    expect(states.at(-1)).toBe("closed");
  });

  it("does not deliver queued socket callbacks after cancellation", () => {
    const { client, sockets } = createHarness();
    const onError = vi.fn();
    const onEvent = vi.fn();
    const unsubscribe = client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onError,
      onEvent,
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });
    const socket = sockets[0];

    unsubscribe();
    socket?.receive(ready);
    socket?.receive(eventBatch(messageEvent(4)));
    socket?.dispatchEvent(new Event("error"));

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops delivering the remaining batch after cancellation", () => {
    const { client, sockets } = createHarness();
    const events: AgentEvent[] = [];
    let unsubscribe: () => void = () => undefined;
    unsubscribe = client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      onEvent: (event) => {
        events.push(event);
        unsubscribe();
      },
      onResyncRequired: vi.fn(),
      sessionId: "runtime-1",
    });
    sockets[0]?.open();
    sockets[0]?.receive(ready);
    sockets[0]?.receive(eventBatch(messageEvent(4), messageEvent(5)));

    expect(events).toEqual([messageEvent(4)]);
  });
});
