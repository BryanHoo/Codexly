import type { AgentEvent, ResyncRequired } from "@codexly/protocol";
import type * as TypeBoxValue from "@sinclair/typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";
import { CodexlyEventError } from "./event-client.js";

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

function createCloseEvent(code: number, reason = ""): Event {
  const event = new Event("close");
  // Node 22 没有浏览器的 CloseEvent，全量测试仅需保留真实关闭事件的 code 语义。
  Object.defineProperty(event, "code", { enumerable: true, value: code });
  Object.defineProperty(event, "reason", { enumerable: true, value: reason });
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

  public serverClose(code = 1006, reason = ""): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(createCloseEvent(code, reason));
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
  it.each([
    ["session expiry", 1008, "Access session expired"],
    ["session revocation", 1008, "Access session expired"],
    ["project deletion", 1008, "Project not found"],
    ["policy rejection without a reason", 1008, ""],
    ["protocol rejection", 1002, "Invalid frame"],
  ])("stops %s before and after connection.ready", async (_scenario, code, reason) => {
    vi.useFakeTimers();
    for (const connected of [false, true]) {
      const { client, sockets } = createHarness();
      const onError = vi.fn();
      const onConnectionState = vi.fn();
      const onResyncRequired = vi.fn();
      const onEvent = vi.fn();
      const unsubscribe = client.subscribeEvents({
        afterSequence: 3,
        projectId: "codexly",
        sessionId: "runtime-1",
        onError,
        onConnectionState,
        onEvent,
        onResyncRequired,
      });
      if (connected) sockets[0]?.receive(ready);
      sockets[0]?.serverClose(code, reason);
      expect(onConnectionState).toHaveBeenLastCalledWith("closed");
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ name: "CodexlyEventError", closeCode: code }),
      );
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(CodexlyEventError);
      expect(onResyncRequired).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(1);
      sockets[0]?.receive(ready);
      sockets[0]?.receive(eventBatch(messageEvent(4)));
      sockets[0]?.serverClose();
      expect(onEvent).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      unsubscribe();
    }
  });

  it("handles synchronous factory failures through the retry path and allows cancellation", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const cause = new Error("WebSocket construction failed");
    const socket = new FakeWebSocket("ws://host.test");
    const factory = vi
      .fn()
      .mockImplementationOnce(() => {
        throw cause;
      })
      .mockReturnValue(socket);
    const client = new CodexlyClient({ baseUrl: "http://host.test", webSocketFactory: factory });
    const onError = vi.fn();
    const onConnectionState = vi.fn();
    const unsubscribe = client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      sessionId: "runtime-1",
      onEvent: vi.fn(),
      onResyncRequired: vi.fn(),
      onError,
      onConnectionState,
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ cause }));
    expect(onConnectionState).toHaveBeenLastCalledWith("reconnecting");
    await vi.advanceTimersByTimeAsync(250);
    expect(factory).toHaveBeenCalledTimes(2);
    socket.receive(ready);
    expect(onConnectionState).toHaveBeenLastCalledWith("connected");
    socket.serverClose();
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("spreads retries across tabs, caps backoff and resets it only after connection.ready", async () => {
    vi.useFakeTimers();
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValue(0.5);
    const tabs = [createHarness(), createHarness()] as const;
    const unsubscribes = tabs.map(({ client }) =>
      client.subscribeEvents({
        afterSequence: 3,
        projectId: "codexly",
        sessionId: "runtime-1",
        onEvent: vi.fn(),
        onResyncRequired: vi.fn(),
      }),
    );
    tabs.forEach(({ sockets }) => sockets[0]?.serverClose());
    await vi.advanceTimersByTimeAsync(200);
    expect(tabs.map(({ sockets }) => sockets.length)).toEqual([2, 1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(tabs.map(({ sockets }) => sockets.length)).toEqual([2, 2]);
    const sockets = tabs[0].sockets;
    for (const delay of [500, 1_000, 2_000, 4_000, 5_000, 5_000]) {
      const count = sockets.length;
      sockets.at(-1)?.open();
      sockets.at(-1)?.serverClose();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(count + 1);
    }
    sockets.at(-1)?.receive(ready);
    sockets.at(-1)?.serverClose(1008);
    tabs[1].sockets.at(-1)?.receive(ready);
    tabs[1].sockets.at(-1)?.serverClose();
    await vi.advanceTimersByTimeAsync(250);
    expect(tabs[1].sockets).toHaveLength(3);
    tabs[1].sockets.at(-1)?.serverClose(1008);
    expect(vi.getTimerCount()).toBe(0);
    unsubscribes.forEach((unsubscribe) => {
      unsubscribe();
    });
    random.mockRestore();
  });

  it.each(["x", "中", "😀"])("rejects oversized UTF-8 frames before parsing (%j)", (character) => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness();
    const onEvent = vi.fn();
    const onResyncRequired = vi.fn();
    client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      sessionId: "runtime-1",
      onEvent,
      onResyncRequired,
    });
    const socket = sockets[0];
    if (socket === undefined) throw new Error("Expected a subscribed socket");
    socket.open();
    socket.receive(ready);
    const data = JSON.stringify(eventBatch(messageEvent(4, character.repeat(400 * 1_024))));
    // ASCII 使用更长帧，中文用少于 1 Mi 字符复现 UTF-8 字节越界。
    const oversizedData = character === "x" ? data + " ".repeat(1_024 * 1_024) : data;
    const parse = vi.spyOn(JSON, "parse");
    socket.dispatchEvent(new MessageEvent("message", { data: oversizedData }));

    expect(parse.mock.calls.length).toBe(0);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onResyncRequired).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a frame exactly at the byte budget", () => {
    const { client, sockets } = createHarness();
    const onEvent = vi.fn();
    const onResyncRequired = vi.fn();
    client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      sessionId: "runtime-1",
      onEvent,
      onResyncRequired,
    });
    sockets[0]?.receive(ready);
    const data = JSON.stringify(eventBatch(messageEvent(4)));
    const padding = " ".repeat(1_024 * 1_024 - new TextEncoder().encode(data).byteLength);
    sockets[0]?.dispatchEvent(new MessageEvent("message", { data: data + padding }));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onResyncRequired).not.toHaveBeenCalled();
  });

  it("refreshes the snapshot on an oversized-event server close without retrying", () => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness();
    const onResyncRequired = vi.fn();
    client.subscribeEvents({
      afterSequence: 3,
      projectId: "codexly",
      sessionId: "runtime-1",
      onEvent: vi.fn(),
      onResyncRequired,
    });
    sockets[0]?.receive(ready);
    sockets[0]?.serverClose(1009);
    expect(onResyncRequired).toHaveBeenCalledWith({
      latestSequence: 3,
      reason: "event_retention_exceeded",
      sessionId: "runtime-1",
      type: "resync.required",
      version: 3,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

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
    vi.spyOn(Math, "random").mockReturnValue(0.5);
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
