import { afterEach, expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

class Socket extends EventTarget {
  close(code = 1000) {
    this.dispatchEvent(new CloseEvent("close", { code }));
  }
  message(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
afterEach(() => vi.useRealTimers());

test("workbench changes validate frames, reconnect and clean up", async () => {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  const factory = vi.fn(() => {
    const socket = new Socket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  const changed = vi.fn();
  const client = new CodexlyClient({ baseUrl: "https://host.test", webSocketFactory: factory });
  const unsubscribe = client.subscribeWorkbenchChanges(changed);
  expect(factory).toHaveBeenCalledWith("wss://host.test/v1/workbench/events");
  sockets[0]?.message({ type: "workbench.ready" });
  const change = { type: "project-todos.changed", projectId: "project-a" };
  sockets[0]?.message(change);
  expect(changed).toHaveBeenNthCalledWith(1, { type: "workbench.ready" });
  expect(changed).toHaveBeenNthCalledWith(2, change);
  sockets[0]?.close(1006);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(factory).toHaveBeenCalledTimes(2);
  sockets[0]?.message(change);
  expect(changed).toHaveBeenCalledTimes(2);
  sockets[1]?.message({ type: "async-questions.changed", projectId: "project-a" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(factory).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});

test("workbench subscription stops retrying expired sessions", async () => {
  vi.useFakeTimers();
  const socket = new Socket();
  const factory = vi.fn(() => socket as unknown as WebSocket);
  const client = new CodexlyClient({ baseUrl: "http://host.test", webSocketFactory: factory });
  const unsubscribe = client.subscribeWorkbenchChanges(vi.fn());
  socket.close(1008);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(factory).toHaveBeenCalledOnce();
  unsubscribe();
});
