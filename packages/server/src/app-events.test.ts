import { Buffer } from "node:buffer";
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
import { WebSocket } from "ws";
import type { ConnectionReady, EventStreamMessage } from "@codexly/protocol";
import { createCodexlyServer } from "./app.js";
import { AgentEventStream } from "./agent-event-stream.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

async function createLoopbackHarness() {
  const { app, emitEvent } = await createHarness();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  expect((await app.inject("/v1/projects/codexly/tasks")).statusCode).toBe(200);
  const delta = "x".repeat(292 * 1_024);
  const publish = (sequence: number) => {
    emitEvent({
      itemId: `event-${String(sequence)}`,
      payload: { delta },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
  };
  const connect = (afterSequence: number) => {
    const url = new URL("/v1/projects/codexly/events", address);
    url.protocol = "ws:";
    url.searchParams.set("afterSequence", String(afterSequence));
    const socket = new WebSocket(url, { headers: { origin: address } });
    const received = {
      sequences: [] as number[],
      ready: undefined as ConnectionReady | undefined,
      closeCode: undefined as number | undefined,
    };
    socket.on("message", (data) => {
      if (!Buffer.isBuffer(data)) throw new Error("Expected a WebSocket message buffer");
      const message = JSON.parse(data.toString()) as EventStreamMessage;
      if (message.type === "connection.ready") received.ready = message;
      if (message.type === "events.batch")
        received.sequences.push(...message.events.map(({ sequence }) => sequence));
    });
    socket.on("close", (code) => {
      received.closeCode = code;
    });
    return { socket, received };
  };
  return { app, connect, publish };
}

describe("server event delivery", () => {
  it("replays the full retained window over one real WebSocket", async () => {
    const { app, publish, connect } = await createLoopbackHarness();
    // 14 个事件连同 JSON 元数据占用接近 4 MiB，且全部在保留窗口内。
    for (let index = 1; index <= 14; index += 1) publish(index);
    const { socket, received } = connect(0);
    try {
      await vi.waitFor(() => {
        expect(received.closeCode).toBeUndefined();
        expect(received.sequences).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
      });
      expect(received.ready?.latestSequence).toBe(14);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      const metrics = await app.inject("/v1/metrics/events");
      expect(metrics.json()).toMatchObject({
        projects: [{ retainedEvents: 14, retentionEvictions: 0, slowClientDisconnects: 0 }],
      });
    } finally {
      socket.terminate();
    }
  });

  it.each([
    { newEvents: 2, overload: false },
    { newEvents: 15, overload: true },
  ])(
    "preserves event ordering and isolates stalled replay (overload: $overload)",
    async ({ newEvents, overload }) => {
      const { app, connect, publish } = await createLoopbackHarness();
      for (let index = 1; index <= 14; index += 1) publish(index);
      let completeWrite: (() => void) | undefined;
      app.websocketServer.once("connection", (socket: WebSocket) => {
        const send = socket.send.bind(socket);
        const spy = vi.spyOn(socket, "send").mockImplementation((data, options, callback) => {
          const onWritten =
            typeof options === "function" ? (options as (error?: Error) => void) : callback;
          if (
            typeof data !== "string" ||
            !data.startsWith('{"events":[') ||
            onWritten === undefined
          ) {
            send(data, options, callback);
            return;
          }
          // 保留真实 TCP 发送，只延迟第一帧的写入回调，使背压时机与内核缓冲大小无关。
          spy.mockRestore();
          send(data, (error) => {
            completeWrite = () => {
              onWritten(error);
            };
          });
        });
      });
      const replaying = connect(0);
      let healthy: ReturnType<typeof connect> | undefined;
      try {
        await vi.waitFor(() => {
          expect(completeWrite).toBeTypeOf("function");
          expect(replaying.received.sequences).toEqual([1, 2, 3]);
        });
        healthy = connect(14);
        const live = healthy;
        await vi.waitFor(() => {
          expect(live.received.ready?.latestSequence).toBe(14);
        });
        for (let index = 15; index <= 14 + newEvents; index += 1) {
          publish(index);
          await vi.waitFor(
            () => {
              expect(live.received.sequences.at(-1)).toBe(index);
            },
            {
              interval: 5,
            },
          );
        }
        expect(replaying.received.sequences).toEqual([1, 2, 3]);
        if (overload) {
          await vi.waitFor(() => {
            expect(replaying.received.closeCode).toBe(1013);
          });
        }
        completeWrite?.();
        if (!overload) {
          await vi.waitFor(() => {
            expect(replaying.received.sequences).toEqual(
              Array.from({ length: 14 + newEvents }, (_, index) => index + 1),
            );
          });
          expect(replaying.socket.readyState).toBe(WebSocket.OPEN);
        }
        expect(live.received.sequences).toEqual(
          Array.from({ length: newEvents }, (_, index) => index + 15),
        );
        expect(live.socket.readyState).toBe(WebSocket.OPEN);
        const metrics = await app.inject("/v1/metrics/events");
        expect(metrics.json()).toMatchObject({
          projects: [
            {
              activeClients: overload ? 1 : 2,
              slowClientDisconnects: overload ? 1 : 0,
            },
          ],
        });
      } finally {
        replaying.socket.terminate();
        healthy?.socket.terminate();
      }
    },
  );

  it("closes oversized live events with 1009 and requires a snapshot on replay", async () => {
    const { app, emitEvent } = await createHarness();
    const messages: unknown[] = [];
    let closeCode: number | undefined;
    const connect = async () =>
      await app.injectWS(
        "/v1/projects/codexly/events?afterSequence=0",
        { headers: { host: "localhost", origin: "http://localhost" } },
        {
          onInit(socket) {
            socket.on("message", (data: { toString(): string }) => {
              messages.push(JSON.parse(data.toString()) as unknown);
            });
            socket.on("close", (code: number) => {
              closeCode = code;
            });
          },
        },
      );
    await connect();
    await vi.waitFor(() => {
      expect(messages).toHaveLength(1);
    });
    emitEvent({
      itemId: "large-item",
      payload: { delta: "x".repeat(512 * 1_024) },
      taskId: "task-1",
      turnId: "turn-1",
      type: "message.delta",
    });
    await vi.waitFor(() => {
      expect(closeCode).toBe(1009);
    });
    expect(messages).toHaveLength(1);

    await connect();
    await vi.waitFor(() => {
      expect(messages).toHaveLength(2);
    });
    expect(messages[1]).toMatchObject({
      latestSequence: 1,
      reason: "event_retention_exceeded",
      type: "resync.required",
    });
  });

  it("streams ready and realtime Agent Events over WebSocket", async () => {
    const { app, emitEvent } = await createHarness();
    const messages: unknown[] = [];
    const socket = await app.injectWS(
      "/v1/projects/codexly/events?afterSequence=0",
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
    expect(metricsResponse.json()).toMatchObject({
      eventLoopDelayMs: {
        count: expect.any(Number) as number,
        p95: expect.any(Number) as number,
        p99: expect.any(Number) as number,
      },
      projects: [
        {
          activeClients: 1,
          backpressureSignals: 0,
          coalescedEvents: 0,
          pendingDeltas: 0,
          queueBytes: expect.any(Number) as number,
          queueBytesPerBatch: {
            count: expect.any(Number) as number,
            p95: expect.any(Number) as number,
            p99: expect.any(Number) as number,
          },
          queueWaitMs: {
            count: expect.any(Number) as number,
            p95: expect.any(Number) as number,
            p99: expect.any(Number) as number,
          },
          snapshotRetries: 0,
          snapshotRetriesPerRead: { count: 0, p95: 0, p99: 0 },
          projectId: "codexly",
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
        "/v1/projects/codexly/events?afterSequence=0",
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
    const app = await createCodexlyServer(createServerOptions(harness.provider));
    closeCallbacks.push(() => app.close());
    await app.inject({ method: "GET", url: "/v1/projects/codexly/tasks" });

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
      "/v1/projects/codexly/events?afterSequence=0",
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
    const app = await createCodexlyServer(
      createServerOptions(harness.provider, { eventBufferSize: 1 }),
    );
    closeCallbacks.push(() => app.close());
    // 首次 Project 访问激活事件流；激活前状态由后续权威 Snapshot 恢复。
    const activationResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks",
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
      "/v1/projects/codexly/events?afterSequence=1",
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
      "/v1/projects/codexly/events?afterSequence=0",
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
      app.injectWS("/v1/projects/codexly/events?afterSequence=-1", {
        headers: { host: "localhost", origin: "http://localhost" },
      }),
    ).rejects.toThrow(/Unexpected server response: 400/u);
    await expect(
      app.injectWS("/v1/projects/codexly/events?afterSequence=0", {
        headers: { host: "localhost", origin: "http://attacker.example" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("unsubscribes from Provider events when Fastify closes", async () => {
    const { app, eventListeners } = await createHarness();
    await app.inject({ method: "GET", url: "/v1/projects/codexly/tasks" });
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
      url: "/v1/projects/codexly/tasks/missing",
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
      url: "/v1/projects/codexly/tasks?limit=0",
    });

    expect(response.statusCode).toBe(400);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("serves precompressed static assets and applies content-aware cache policies", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "codexly-web-"));
    const assetsRoot = join(staticRoot, "assets");
    const htmlBody = "<main>Codexly Web</main>";
    const assetBody = "export const value = 'Codexly';\n".repeat(128);
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
    const app = await createCodexlyServer(
      createServerOptions(createProvider().provider, { staticRoot }),
    );
    closeCallbacks.push(() => app.close());

    const routeResponse = await app.inject({
      headers: { "accept-encoding": "br" },
      method: "GET",
      url: "/p/codexly/t/task-1",
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
    expect(routeResponse.headers["cache-control"]).toBe("no-store");
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
