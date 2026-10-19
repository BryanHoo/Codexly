import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { AgentEventStream } from "./agent-event-stream.js";
import { createCodexlyServer } from "./app.js";
import { createProvider, createServerOptions } from "./app-all.test-support.js";

const headers = { host: "localhost", origin: "http://localhost" };
const chatPath = "/v1/projects/codexly/events?afterSequence=0";

afterEach(() => {
  vi.useRealTimers();
});

describe("event WebSocket heartbeat", () => {
  it("keeps real TCP connections alive after successful heartbeat writes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const clients: WebSocket[] = [];
    try {
      for (const path of [chatPath, "/v1/workbench/events", "/v1/scheduled-tasks/events"]) {
        const client = new WebSocket(`${address.replace("http:", "ws:")}${path}`, {
          headers: { origin: address },
        });
        clients.push(client);
        await new Promise<void>((resolve, reject) => {
          client.once("open", resolve);
          client.once("error", reject);
        });
      }
      const serverSockets = [...app.websocketServer.clients];
      expect(serverSockets).toHaveLength(3);
      // injectWS 的内存传输无法覆盖真实 TCP 写入成功回调返回 null 的情况。
      // 同时监听 pong 与关闭，确保误杀正常连接时能立即给出明确失败。
      const outcomes = serverSockets.map(
        (socket) =>
          new Promise<string>((resolve) => {
            socket.once("pong", () => {
              resolve("pong");
            });
            socket.once("close", () => {
              resolve("closed");
            });
          }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await Promise.all(outcomes)).toEqual(["pong", "pong", "pong"]);
      expect(serverSockets.every((socket) => socket.readyState === socket.OPEN)).toBe(true);
    } finally {
      for (const client of clients) client.terminate();
      await app.close();
    }
  });

  it.each([chatPath, "/v1/workbench/events", "/v1/scheduled-tasks/events"])(
    "terminates an unresponsive connection on %s",
    async (path) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { provider } = createProvider();
      const app = await createCodexlyServer(createServerOptions(provider));
      const socket = await app.injectWS(
        path,
        { headers },
        {
          onInit(client) {
            // 只屏蔽自动 pong，保留打开的传输，确定性模拟 TCP 尚未报告断开的半开连接。
            vi.spyOn(client, "pong").mockImplementation(() => undefined);
          },
        },
      );
      const ping = vi.fn();
      socket.on("ping", ping);
      try {
        await vi.advanceTimersByTimeAsync(30_000);
        await setImmediate();
        expect(ping).toHaveBeenCalledOnce();
        expect(socket.readyState).toBe(socket.OPEN);

        await vi.advanceTimersByTimeAsync(30_000);
        await setImmediate();
        expect(socket.readyState).toBe(socket.CLOSED);
        if (path === chatPath) {
          const response = await app.inject({ method: "GET", url: "/v1/metrics/events" });
          expect(response.json()).toMatchObject({ projects: [{ activeClients: 0 }] });
        }
      } finally {
        socket.terminate();
        await app.close();
      }
    },
  );

  it("keeps responsive connections alive with one shared timer and disposes it on shutdown", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { provider } = createProvider();
    const app = await createCodexlyServer(createServerOptions(provider));
    const baselineTimers = vi.getTimerCount();
    const sockets: WebSocket[] = [];
    try {
      for (const path of [chatPath, "/v1/workbench/events", "/v1/scheduled-tasks/events"]) {
        sockets.push(
          await app.injectWS(
            path,
            { headers },
            {
              onInit(client) {
                // injectWS 不启用 ws 的自动 pong，显式应答以模拟浏览器的协议层行为。
                client.on("ping", (data) => {
                  client.pong(data);
                });
              },
            },
          ),
        );
      }
      expect(vi.getTimerCount() - baselineTimers).toBeLessThanOrEqual(1);
      for (let tick = 0; tick < 3; tick += 1) {
        await vi.advanceTimersByTimeAsync(30_000);
        await setImmediate();
        expect(sockets.every((socket) => socket.readyState === socket.OPEN)).toBe(true);
      }
    } finally {
      await app.close();
    }
    expect(sockets.every((socket) => socket.readyState === socket.CLOSED)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the idle project after a half-open chat connection loses its heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { provider, eventListeners } = createProvider();
    const unsubscribe = vi.fn();
    vi.spyOn(AgentEventStream.prototype, "subscribe").mockReturnValue(unsubscribe);
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        projectRuntimeCleanupIntervalMs: 10_000,
        projectRuntimeIdleTtlMs: 1,
      }),
    );
    const socket = await app.injectWS(
      chatPath,
      { headers },
      {
        onInit(client) {
          vi.spyOn(client, "pong").mockImplementation(() => undefined);
        },
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(eventListeners.size).toBe(1);
      expect(unsubscribe).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      await setImmediate();
      expect(unsubscribe).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(eventListeners.size).toBe(0);
      const response = await app.inject({ method: "GET", url: "/v1/metrics/events" });
      expect(response.json()).toMatchObject({ projects: [] });
    } finally {
      socket.terminate();
      await app.close();
    }
  });
});
