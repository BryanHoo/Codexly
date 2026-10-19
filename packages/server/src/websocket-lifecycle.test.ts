import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { WebSocketLifecycle, WEBSOCKET_HEARTBEAT_INTERVAL_MS } from "./websocket-lifecycle.js";

class TestSocket extends EventEmitter {
  public readonly OPEN = 1;
  public readyState = this.OPEN;
  public readonly ping = vi.fn<WebSocket["ping"]>();
  // 故意不触发 close，证明清理不依赖底层传输及时发出关闭事件。
  public readonly terminate = vi.fn();

  public asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WebSocketLifecycle", () => {
  it("cleans up a lost connection immediately and only once before close arrives", () => {
    vi.useFakeTimers();
    const lifecycle = new WebSocketLifecycle();
    const socket = new TestSocket();
    const cleanup = vi.fn();
    const dispose = lifecycle.track(socket.asWebSocket(), cleanup);

    vi.advanceTimersByTime(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    expect(socket.ping).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(socket.listenerCount("pong")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    socket.emit("error", new Error("late transport error"));
    socket.emit("close");
    dispose();
    lifecycle.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("removes closed connections, stops an empty timer and restarts for new connections", () => {
    vi.useFakeTimers();
    const lifecycle = new WebSocketLifecycle();
    const socket = new TestSocket();
    const cleanup = vi.fn();
    lifecycle.track(socket.asWebSocket(), cleanup);
    socket.emit("close");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(socket.terminate).not.toHaveBeenCalled();

    const next = new TestSocket();
    lifecycle.track(next.asWebSocket(), vi.fn());
    vi.advanceTimersByTime(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    expect(next.ping).toHaveBeenCalledOnce();
    expect(socket.ping).not.toHaveBeenCalled();
    lifecycle.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "callback", "error", "closing"])(
    "isolates %s failures while continuing other connections' heartbeats",
    (failure) => {
      vi.useFakeTimers();
      const lifecycle = new WebSocketLifecycle();
      const broken = new TestSocket();
      const healthy = new TestSocket();
      const cleanup = vi.fn();
      lifecycle.track(broken.asWebSocket(), cleanup);
      lifecycle.track(healthy.asWebSocket(), vi.fn());
      if (failure === "throw") {
        broken.ping.mockImplementation(() => {
          throw new Error("ping failed");
        });
      } else if (failure === "callback") {
        broken.ping.mockImplementation((_data, _mask, callback) =>
          callback?.(new Error("ping failed")),
        );
      } else if (failure === "error") {
        broken.emit("error", new Error("transport failed"));
      } else {
        broken.readyState = 2;
      }

      vi.advanceTimersByTime(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(broken.terminate).toHaveBeenCalledOnce();
      expect(healthy.ping).toHaveBeenCalledOnce();
      expect(healthy.terminate).not.toHaveBeenCalled();
      healthy.emit("pong");
      vi.advanceTimersByTime(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
      expect(healthy.ping).toHaveBeenCalledTimes(2);
      lifecycle.close();
    },
  );

  it("disposes all connections on shutdown and rejects later tracking", () => {
    vi.useFakeTimers();
    const lifecycle = new WebSocketLifecycle();
    const cleanup = vi.fn();
    const sockets = [new TestSocket(), new TestSocket()];
    for (const socket of sockets) lifecycle.track(socket.asWebSocket(), cleanup);
    lifecycle.close();
    lifecycle.close();
    expect(cleanup).toHaveBeenCalledTimes(2);
    for (const socket of sockets) expect(socket.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    const late = new TestSocket();
    lifecycle.track(late.asWebSocket(), cleanup);
    expect(late.terminate).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
