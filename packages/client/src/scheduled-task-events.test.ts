import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

class Socket extends EventTarget {
  close(code = 1000) {
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }
  changed() {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "scheduled-tasks.changed" }) }),
    );
  }
}
afterEach(() => vi.useRealTimers());
describe("scheduled task push subscription", () => {
  it("delivers changes, reconnects and releases listeners and timers on cancellation", async () => {
    vi.useFakeTimers();
    const sockets: Socket[] = [];
    const factory = vi.fn(() => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const client = new CodexlyClient({ baseUrl: "https://host.test", webSocketFactory: factory });
    const changed = vi.fn();
    const unsubscribe = client.subscribeScheduledTasks(changed);
    expect(factory).toHaveBeenCalledWith("wss://host.test/v1/scheduled-tasks/events");
    sockets[0]?.changed();
    expect(changed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledOnce();
    sockets[0]?.close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(factory).toHaveBeenCalledTimes(2);
    sockets[0]?.changed();
    expect(changed).toHaveBeenCalledOnce();
    sockets[1]?.changed();
    expect(changed).toHaveBeenCalledTimes(2);
    sockets[1]?.close(1006);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledTimes(2);
  });
  it("does not reconnect after session expiry", async () => {
    vi.useFakeTimers();
    const socket = new Socket();
    const factory = vi.fn(() => socket as unknown as WebSocket);
    const client = new CodexlyClient({ baseUrl: "http://host.test", webSocketFactory: factory });
    const unsubscribe = client.subscribeScheduledTasks(vi.fn());
    socket.close(1008);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(factory).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
