import { createCodexlyServer } from "./app.js";
import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import {
  createHarness,
  snapshot,
  createProvider,
  createServerOptions,
  closeCallbacks,
} from "./app-all.test-support.js";

it("does not acknowledge completion with a snapshot captured before history pagination", async () => {
  const h = await createHarness();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const completed = {
    ...snapshot,
    status: "idle" as const,
    turns: [
      {
        id: "turn-1",
        status: "completed" as const,
        error: null,
        startedAt: null,
        completedAt: null,
        items: [],
      },
    ],
    pendingRequests: [],
  };
  h.readTask.mockImplementationOnce(async () => {
    // 模拟 Provider 已复制 running 投影，但分页磁盘读取尚未返回。
    entered.resolve(undefined);
    await release.promise;
    return { ...snapshot, status: "running" };
  });
  h.readTask.mockResolvedValue(completed);
  const response = h.app.inject({ method: "GET", url: "/v1/projects/codexly/tasks/task-1" });
  await entered.promise;
  const completedTurn = completed.turns[0];
  if (completedTurn === undefined) throw new Error("Missing completed turn fixture");
  h.emitEvent({
    type: "turn.completed",
    taskId: "task-1",
    turnId: "turn-1",
    payload: { turn: completedTurn },
  });
  release.resolve(undefined);
  const result = await response;
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({
    checkpoint: { sequence: 1 },
    snapshot: { status: "idle", turns: [{ status: "completed" }] },
  });
  expect(h.readTask).toHaveBeenCalledTimes(2);
  expect(h.eventListeners.size).toBe(1);
});

it("replays events arriving during answer restoration instead of moving the snapshot boundary", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const h = await createHarness({
    asyncQuestionRepository: {
      listAsyncQuestions: async () => {
        entered.resolve(undefined);
        await release.promise;
        return [];
      },
      discoverAsyncQuestions: () => Promise.resolve(),
      updateAsyncQuestion: () => Promise.resolve(false),
      dismissAsyncQuestions: () => Promise.resolve(),
    },
  });
  const reading = h.app.inject({ method: "GET", url: "/v1/projects/codexly/tasks/task-1" });
  await entered.promise;
  h.emitEvent({
    type: "message.delta",
    taskId: "task-1",
    turnId: "turn-1",
    itemId: "message",
    payload: { delta: "不丢失" },
  });
  release.resolve(undefined);
  const result = await reading;
  expect(result.statusCode).toBe(200);
  const response = result.json<AgentTaskSnapshotResponse>();
  expect(response.checkpoint.sequence).toBe(0);
  const events: AgentEvent[] = [];
  const socket = await h.app.injectWS(
    `/v1/projects/codexly/events?afterSequence=${String(response.checkpoint.sequence)}&sessionId=${response.checkpoint.sessionId}`,
    { headers: { host: "localhost", origin: "http://localhost" } },
    {
      onInit(socket) {
        socket.on("message", (data: { toString(): string }) => {
          const frame = JSON.parse(data.toString()) as { events?: AgentEvent[] };
          events.push(...(frame.events ?? []));
        });
      },
    },
  );
  try {
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    expect(events[0]).toMatchObject({ sequence: 1, payload: { delta: "不丢失" } });
  } finally {
    socket.terminate();
  }
});

it("returns an identifiable retryable busy response after at most two conflicting reads", async () => {
  const h = await createHarness();
  h.readTask.mockImplementation(() => {
    h.emitEvent({
      type: "message.delta",
      taskId: "task-1",
      turnId: "turn-1",
      itemId: "message",
      payload: { delta: "持续" },
    });
    return Promise.resolve(snapshot);
  });
  const response = await h.app.inject({ method: "GET", url: "/v1/projects/codexly/tasks/task-1" });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toMatchObject({ code: "TASK_SNAPSHOT_BUSY", retryable: true });
  expect(h.readTask).toHaveBeenCalledTimes(2);
  expect(h.eventListeners.size).toBe(1);
});

it.each(["disconnect", "handler timeout"] as const)(
  "cancels snapshot preparation on %s without late rereads",
  async (mode) => {
    const h = createProvider();
    const observed = Promise.withResolvers<AbortSignal | undefined>();
    const aborted = Promise.withResolvers<undefined>();
    const pending = Promise.withResolvers<typeof snapshot>();
    h.readTask.mockImplementation((_id, input) => {
      observed.resolve(input?.signal);
      input?.signal?.addEventListener(
        "abort",
        () => {
          aborted.resolve(undefined);
        },
        { once: true },
      );
      return pending.promise;
    });
    const app = await createCodexlyServer(
      createServerOptions(h.provider, { handlerTimeoutMs: mode === "handler timeout" ? 100 : 0 }),
    );
    closeCallbacks.push(() => app.close());
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = fetch(`${address}/v1/projects/codexly/tasks/task-1`, {
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      const signal = await observed.promise;
      expect(signal?.aborted).toBe(false);
      if (mode === "disconnect") controller.abort();
      const result = await response;
      if (mode === "handler timeout") expect(result?.status).toBe(503);
      await aborted.promise;
      expect(signal?.aborted).toBe(true);
      pending.resolve(snapshot);
      await vi.waitFor(() => {
        expect(h.eventListeners.size).toBe(1);
      });
      expect(h.readTask).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
      pending.resolve(snapshot);
      await response;
    }
  },
);
