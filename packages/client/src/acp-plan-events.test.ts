import { afterEach, expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
class Socket extends EventTarget {
  close(code = 1000) {
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }
  changed() {
    this.dispatchEvent(new MessageEvent("message", { data: '{"type":"acp-plans.changed"}' }));
  }
}
afterEach(() => vi.useRealTimers());
it("计划订阅共用独立连接、重连校准和最后取消清理，不新增轮询", async () => {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  const factory = vi.fn(() => {
    const s = new Socket();
    sockets.push(s);
    return s as unknown as WebSocket;
  });
  const client = new CodexlyClient({ baseUrl: "https://example.test", webSocketFactory: factory });
  const a = vi.fn(),
    b = vi.fn();
  const stopA = client.subscribeAcpPlans(a);
  sockets[0]?.changed();
  const stopB = client.subscribeAcpPlans(b);
  await vi.advanceTimersByTimeAsync(0);
  expect(factory).toHaveBeenCalledExactlyOnceWith("wss://example.test/v1/acp/plans/events");
  expect(b).toHaveBeenCalledOnce();
  sockets[0]?.changed();
  expect(a).toHaveBeenCalledTimes(2);
  expect(b).toHaveBeenCalledTimes(2);
  stopA();
  sockets[0]?.close(1006);
  await vi.advanceTimersByTimeAsync(1000);
  expect(factory).toHaveBeenCalledTimes(2);
  sockets[0]?.changed();
  expect(b).toHaveBeenCalledTimes(2);
  sockets[1]?.changed();
  expect(b).toHaveBeenCalledTimes(3);
  stopB();
  await vi.advanceTimersByTimeAsync(60000);
  expect(factory).toHaveBeenCalledTimes(2);
});
