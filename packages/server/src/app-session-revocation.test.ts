import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

describe("session WebSocket revocation", () => {
  it("closes all logged-out session streams while preserving other sessions", async () => {
    const { provider, emitEvent } = createProvider();
    const app = await createCodexlyServer(
      createServerOptions(provider, { access: { pairingCode: "test-code" } }),
    );
    closeCallbacks.push(() => app.close());
    const pair = async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/access/pair",
        payload: { code: "test-code" },
      });
      const cookie = response.cookies[0];
      if (cookie === undefined) throw new Error("Missing session cookie");
      return cookie.value;
    };
    const session = await pair();
    const other = await pair();
    const headers = (value: string) => ({
      cookie: `codexly_session=${value}`,
      host: "localhost",
      origin: "http://localhost",
    });
    const paths = [
      "/v1/projects/codexly/events?afterSequence=0",
      "/v1/scheduled-tasks/events",
    ] as const;
    const sockets: WebSocket[] = [];
    for (const path of paths) {
      sockets.push(await app.injectWS(path, { headers: headers(session) }));
    }
    const survivor = await app.injectWS(paths[0], { headers: headers(other) });
    const received = vi.fn();
    const survivorReceived = vi.fn();
    // 等待初始化帧交付，后续只观察注销之后的新事件。
    await new Promise<void>((resolve) => setImmediate(resolve));
    sockets.forEach((socket) => socket.on("message", received));
    survivor.on("message", survivorReceived);
    const closes = sockets.map((socket) => {
      const close = vi.fn();
      socket.on("close", close);
      return close;
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/access/logout",
        headers: headers(session),
      });
      expect(response.statusCode).toBe(200);
      emitEvent({
        itemId: "item-1",
        taskId: "task-1",
        turnId: "turn-1",
        payload: { delta: "private" },
        type: "message.delta",
      });
      await vi.waitFor(() => {
        sockets.forEach((socket) => {
          expect(socket.readyState).toBe(socket.CLOSED);
        });
        expect(survivorReceived).toHaveBeenCalled();
      });
      expect(received).not.toHaveBeenCalled();
      closes.forEach((close) => {
        expect(close).toHaveBeenCalledWith(1008, expect.any(Buffer));
      });
      expect(survivor.readyState).toBe(survivor.OPEN);
      await expect(app.injectWS(paths[0], { headers: headers(session) })).rejects.toThrow(/401/u);
    } finally {
      sockets.forEach((socket) => {
        socket.terminate();
      });
      survivor.terminate();
    }
  });
});
