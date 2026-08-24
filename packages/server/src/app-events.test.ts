import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  gzipSync,
  gunzipSync,
} from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import { AgentEventStream } from "./agent-event-stream.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

describe("server event delivery", () => {
  it("streams ready and realtime Agent Events over WebSocket", async () => {
    const { app, emitEvent } = await createHarness();
    const messages: unknown[] = [];
    const socket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=0",
      { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            messages.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );

    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });
    emitEvent({
      itemId: "item-1",
      payload: { delta: "实时" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    emitEvent({
      itemId: "item-2",
      payload: { delta: "更新" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    emitEvent({
      itemId: "item-3",
      payload: { delta: "完成" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    await vi.waitFor(() => {
      expect(messages).toHaveLength(3);
    });

    expect(messages[0]).toMatchObject({
      latestSequence: 0,
      type: "connection.ready",
      version: 3,
    });
    expect(typeof (messages[0] as { sessionId: unknown }).sessionId).toBe("string");
    expect(messages[1]).toMatchObject({
      events: [{ payload: { delta: "实时" }, sequence: 1, type: "message.delta", version: 2 }],
      type: "events.batch",
      version: 3,
    });
    expect(typeof (messages[1] as { events: [{ sessionId: unknown }] }).events[0].sessionId).toBe(
      "string",
    );
    expect(messages[2]).toMatchObject({
      events: [
        { payload: { delta: "更新" }, sequence: 2, type: "message.delta" },
        { payload: { delta: "完成" }, sequence: 3, type: "message.delta" },
      ],
      type: "events.batch",
      version: 3,
    });

    const metricsResponse = await app.inject({ method: "GET", url: "/v1/metrics/events" });
    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.json()).toEqual({
      projects: [
        {
          activeClients: 1,
          backpressureSignals: 0,
          coalescedEvents: 0,
          pendingDeltas: 0,
          projectId: "code-agent",
          providerEventsReceived: 3,
          publishedEvents: 3,
          retainedEvents: 3,
          retentionEvictions: 0,
          slowClientDisconnects: 0,
        },
      ],
      version: 1,
    });
    socket.terminate();
  });

  it("sends connection.ready before a delta queued during WebSocket initialization", async () => {
    const { app } = await createHarness();
    const messages: unknown[] = [];
    const subscribeSpy = vi
      .spyOn(AgentEventStream.prototype, "subscribe")
      .mockImplementationOnce(function (this: AgentEventStream, listener) {
        subscribeSpy.mockRestore();
        const unsubscribe = this.subscribe(listener);
        // 在监听器就绪后同步排入增量，触发初始化期间的 checkpoint flush 竞态。
        this.publish({
          itemId: "item-race",
          payload: { delta: "初始化增量" },
          taskId: "task-1",
          turnId: "turn-1",
          type: "message.delta",
        });
        return unsubscribe;
      });

    let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;
    try {
      socket = await app.injectWS(
        "/v1/projects/code-agent/events?afterSequence=0",
        { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
        {
          onInit(webSocket) {
            webSocket.on("message", (data: { toString(): string }) => {
              messages.push(JSON.parse(data.toString()) as unknown);
            });
          },
        },
      );
    } finally {
      subscribeSpy.mockRestore();
    }

    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });
    expect(messages).toMatchObject([
      { latestSequence: 0, type: "connection.ready", version: 3 },
      {
        events: [{ payload: { delta: "初始化增量" }, sequence: 1, type: "message.delta" }],
        type: "events.batch",
        version: 3,
      },
    ]);
    socket.terminate();
  });

  it("splits replay into ordered batches of at most 64 events", async () => {
    const harness = createProvider();
    const app = await createCodeAgentServer(createServerOptions(harness.provider));
    closeCallbacks.push(() => app.close());
    await app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" });

    for (let index = 1; index <= 65; index += 1) {
      harness.emitEvent({
        itemId: `item-${String(index)}`,
        payload: { delta: String(index) },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      });
    }

    const messages: {
      events?: { sequence: number }[];
      type: string;
    }[] = [];
    const socket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=0",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            messages.push(JSON.parse(data.toString()) as (typeof messages)[number]);
          });
        },
      },
    );

    await vi.waitFor(() => {
      expect(messages).toHaveLength(3);
    });
    expect(messages.map((message) => message.type)).toEqual([
      "connection.ready",
      "events.batch",
      "events.batch",
    ]);
    expect(messages.slice(1).map((message) => message.events?.length)).toEqual([64, 1]);
    expect(
      messages.flatMap((message) => message.events ?? []).map((event) => event.sequence),
    ).toEqual(Array.from({ length: 65 }, (_, index) => index + 1));
    socket.terminate();
  });

  it("replays retained events and requests resync after retention expires", async () => {
    const harness = createProvider();
    const app = await createCodeAgentServer(
      createServerOptions(harness.provider, { eventBufferSize: 1 }),
    );
    closeCallbacks.push(() => app.close());
    // 首次 Project 访问激活事件流；激活前状态由后续权威 Snapshot 恢复。
    const activationResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks",
    });
    expect(activationResponse.statusCode).toBe(200);
    const event = {
      itemId: "item-1",
      payload: { delta: "1" },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    } as const;
    harness.emitEvent(event);
    harness.emitEvent({ ...event, itemId: "item-2", payload: { delta: "2" } });

    const replayed: unknown[] = [];
    const replaySocket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=1",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            replayed.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(replayed).toHaveLength(2);
    });
    expect(replayed[1]).toMatchObject({
      events: [{ payload: { delta: "2" }, sequence: 2 }],
      type: "events.batch",
      version: 3,
    });
    replaySocket.terminate();

    const expired: unknown[] = [];
    const expiredSocket = await app.injectWS(
      "/v1/projects/code-agent/events?afterSequence=0",
      { headers: { host: "localhost", origin: "http://localhost" } },
      {
        onInit(webSocket) {
          webSocket.on("message", (data: { toString(): string }) => {
            expired.push(JSON.parse(data.toString()) as unknown);
          });
        },
      },
    );
    await vi.waitFor(() => {
      expect(expired).toHaveLength(1);
    });
    expect(expired[0]).toMatchObject({
      latestSequence: 2,
      reason: "event_retention_exceeded",
      type: "resync.required",
    });
    await vi.waitFor(() => {
      expect(expiredSocket.readyState).toBe(expiredSocket.CLOSED);
    });
  });

  it("rejects invalid event queries and cross-origin WebSockets", async () => {
    const { app } = await createHarness();

    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=-1", {
        headers: { host: "localhost", origin: "http://localhost" },
      }),
    ).rejects.toThrow(/Unexpected server response: 400/u);
    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "localhost", origin: "http://attacker.example" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("unsubscribes from Provider events when Fastify closes", async () => {
    const { app, eventListeners } = await createHarness();
    await app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks" });
    expect(eventListeners.size).toBe(1);

    await app.close();

    expect(eventListeners.size).toBe(0);
  });

  it("returns 404 for unknown projects and tasks", async () => {
    const { app, listTasks } = await createHarness();
    const projectResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/other/tasks",
    });
    const taskResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks/missing",
    });

    expect(projectResponse.statusCode).toBe(404);
    expect(taskResponse.statusCode).toBe(404);
    expect(listTasks).not.toHaveBeenCalled();
    expect(taskResponse.json()).toEqual({ code: "TASK_NOT_FOUND", message: "Task not found" });
  });

  it("rejects invalid pagination before calling the provider", async () => {
    const { app, listTasks } = await createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/code-agent/tasks?limit=0",
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("serves precompressed static assets and applies content-aware cache policies", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "code-agent-web-"));
    const assetsRoot = join(staticRoot, "assets");
    const htmlBody = "<main>CodeAgent Web</main>";
    const assetBody = "export const value = 'CodeAgent';\n".repeat(128);
    const brotliAsset = brotliCompressSync(assetBody, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
    });
    const gzipAsset = gzipSync(assetBody, { level: 1 });
    await mkdir(assetsRoot);
    await writeFile(join(staticRoot, "index.html"), htmlBody, "utf8");
    await writeFile(join(staticRoot, "index.html.br"), brotliCompressSync(htmlBody));
    await writeFile(join(assetsRoot, "index-CqRfgh3W.js"), assetBody, "utf8");
    await writeFile(join(assetsRoot, "index-CqRfgh3W.js.br"), brotliAsset);
    await writeFile(join(assetsRoot, "index-CqRfgh3W.js.gz"), gzipAsset);
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, { staticRoot }),
    );
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({
      headers: { "accept-encoding": "br" },
      method: "GET",
      url: "/p/code-agent/t/task-1",
    });
    const brotliAssetResponse = await app.inject({
      headers: { "accept-encoding": "br" },
      method: "GET",
      url: "/assets/index-CqRfgh3W.js",
    });
    const gzipAssetResponse = await app.inject({
      headers: { "accept-encoding": "gzip" },
      method: "GET",
      url: "/assets/index-CqRfgh3W.js",
    });
    const identityAssetResponse = await app.inject({
      headers: { "accept-encoding": "identity" },
      method: "GET",
      url: "/assets/index-CqRfgh3W.js",
    });
    const apiResponse = await app.inject({ method: "GET", url: "/v1/missing" });

    expect(routeResponse.statusCode).toBe(200);
    expect(routeResponse.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(routeResponse.rawPayload).toString("utf8")).toBe(htmlBody);
    expect(routeResponse.headers["cache-control"]).toBe("public, max-age=0");
    expect(brotliAssetResponse.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(brotliAssetResponse.headers.vary?.toLowerCase()).toContain("accept-encoding");
    expect(brotliAssetResponse.headers["content-encoding"]).toBe("br");
    expect(brotliAssetResponse.rawPayload).toEqual(brotliAsset);
    expect(brotliDecompressSync(brotliAssetResponse.rawPayload).toString("utf8")).toBe(assetBody);
    expect(gzipAssetResponse.headers["content-encoding"]).toBe("gzip");
    expect(gzipAssetResponse.rawPayload).toEqual(gzipAsset);
    expect(gunzipSync(gzipAssetResponse.rawPayload).toString("utf8")).toBe(assetBody);
    expect(identityAssetResponse.headers["content-encoding"]).toBeUndefined();
    expect(identityAssetResponse.body).toBe(assetBody);
    expect(apiResponse.statusCode).toBe(404);
    expect(apiResponse.headers["content-type"]).toContain("application/json");
  });
});
