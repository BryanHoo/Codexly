import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { createCodexlyServer } from "../../packages/server/src/app.js";
import {
  createProvider,
  createServerOptions,
} from "../../packages/server/src/app-all.test-support.js";
import config from "./vite.config.js";

it("delivers writes and authenticated-origin event upgrades through the development proxy", async () => {
  const { provider } = createProvider();
  const backend = await createCodexlyServer(createServerOptions(provider));
  const root = await mkdtemp(join(tmpdir(), "codexly-vite-proxy-"));
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let socket: WebSocket | undefined;
  try {
    const target = await backend.listen({ host: "127.0.0.1", port: 0 });
    const proxy = config.server?.proxy?.["/v1"];
    if (typeof proxy !== "object") throw new Error("Expected explicit development proxy");
    vite = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, watch: null, proxy: { "/v1": { ...proxy, target } } },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (address == null || typeof address === "string") throw new Error("Expected TCP address");
    const origin = `http://127.0.0.1:${String(address.port)}`;
    const response = await fetch(`${origin}/v1/access/logout`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    socket = new WebSocket(`${origin.replace("http:", "ws:")}/v1/scheduled-tasks/events`, {
      origin,
      handshakeTimeout: 2_000,
    });
    const message = await new Promise<string>((resolve, reject) => {
      socket?.once("message", (data) => {
        if (!Buffer.isBuffer(data)) {
          reject(new Error("Expected a WebSocket text frame"));
          return;
        }
        resolve(data.toString());
      });
      socket?.once("error", reject);
    });
    expect(JSON.parse(message)).toEqual({ type: "scheduled-tasks.changed" });
  } finally {
    socket?.terminate();
    await vite?.close();
    await backend.close();
    await rm(root, { force: true, recursive: true });
  }
}, 10_000);
