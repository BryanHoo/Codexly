import { PendingRequestResolutionError, type AgentProvider } from "@codexly/core";
import { RpcResponseError } from "@codexly/provider-codex";
import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  turnOptions,
  turnRequest,
  task,
  snapshot,
  pendingRequest,
  closeCallbacks,
  createProvider,
  createServerOptions,
  createHarness,
} from "./app-all.test-support.js";

describe("server pending requests and idempotency", () => {
  it("resolves pending requests idempotently with complete identity validation", async () => {
    const { app, resolvePendingRequest, writeTaskSettings } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-1" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: pendingRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/projects/codexly/tasks/task-1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };

    const first = await app.inject(request);
    const repeated = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    expect(first.json()).toEqual({ request: { ...pendingRequest, status: "resolved" } });
    expect(resolvePendingRequest).toHaveBeenCalledTimes(1);
    expect(resolvePendingRequest).toHaveBeenCalledWith({
      ...request.payload,
      requestId: pendingRequest.requestId,
    });
    // 会话级授权只交给当前 Provider 进程，不能写入长期 Task 设置。
    expect(writeTaskSettings).not.toHaveBeenCalled();
  });

  it("rejects cross-project and stale pending request resolutions", async () => {
    const { app, resolvePendingRequest } = await createHarness();
    const request = {
      headers: { "idempotency-key": "resolve-invalid" },
      method: "POST" as const,
      payload: {
        itemId: pendingRequest.itemId,
        projectId: "other-project",
        resolution: { decision: "deny" },
        taskId: pendingRequest.taskId,
        turnId: pendingRequest.turnId,
        type: pendingRequest.type,
      },
      url: `/v1/projects/codexly/tasks/task-1/pending-requests/${encodeURIComponent(pendingRequest.requestId)}/resolve`,
    };
    const crossProject = await app.inject(request);
    expect(crossProject.statusCode).toBe(409);
    expect(crossProject.json()).toMatchObject({ code: "PENDING_REQUEST_MISMATCH" });
    expect(resolvePendingRequest).not.toHaveBeenCalled();

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("mismatch", "identity mismatch"),
    );
    const mismatch = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-mismatch" },
      payload: { ...request.payload, itemId: "other-item", projectId: pendingRequest.projectId },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: "PENDING_REQUEST_MISMATCH" });

    resolvePendingRequest.mockRejectedValueOnce(
      new PendingRequestResolutionError("expired", "request expired"),
    );
    const expired = await app.inject({
      ...request,
      headers: { "idempotency-key": "resolve-expired" },
      payload: { ...request.payload, projectId: pendingRequest.projectId },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json()).toMatchObject({ code: "PENDING_REQUEST_EXPIRED" });
  });

  it("reuses idempotent results for equivalent payload key orders", async () => {
    const { app, startTurn } = await createHarness();
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "equivalent-payload",
    };
    const first = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"input":{"attachments":[],"skills":[],"text":"继续实现","type":"prompt"},"options":{"approvalPolicy":"on-request","approvalsReviewer":"user","model":"gpt-5.6-sol","reasoningEffort":"high","sandboxMode":"workspace-write"}}',
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload:
        '{"options":{"sandboxMode":"workspace-write","reasoningEffort":"high","model":"gpt-5.6-sol","approvalsReviewer":"user","approvalPolicy":"on-request"},"input":{"type":"prompt","text":"继续实现","skills":[],"attachments":[]}}',
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toEqual(first.json());
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps idempotency scopes distinct when resource IDs and keys contain separators", async () => {
    const { app, readTask, startTurn } = await createHarness();
    readTask.mockImplementation((taskId) =>
      Promise.resolve({ ...snapshot, id: taskId, turns: [] }),
    );
    const payload = turnRequest("继续实现");

    const first = await app.inject({
      headers: { "idempotency-key": "b:c" },
      method: "POST",
      payload,
      url: "/v1/projects/codexly/tasks/task%3Aa/turns",
    });
    const second = await app.inject({
      headers: { "idempotency-key": "c" },
      method: "POST",
      payload,
      url: "/v1/projects/codexly/tasks/task%3Aa%3Ab/turns",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      "task:a",
      { files: [], images: [], skills: [], text: payload.input.text, textAttachments: [] },
      payload.options,
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      "task:a:b",
      { files: [], images: [], skills: [], text: payload.input.text, textAttachments: [] },
      payload.options,
    );
  });

  it("evicts completed idempotency entries when the cache reaches its limit", async () => {
    const { app, startTask } = await createHarness({ idempotencyCacheSize: 1 });
    const createTask = (key: string) =>
      app.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload: {},
        url: "/v1/projects/codexly/tasks",
      });

    await createTask("task-key-1");
    await createTask("task-key-2");
    await createTask("task-key-1");

    expect(startTask).toHaveBeenCalledTimes(3);
  });

  it("rejects new idempotency keys when the in-flight limit is reached", async () => {
    const { app, startTask } = await createHarness({ idempotencyCacheSize: 1 });
    let resolveStartTask!: (value: typeof task) => void;
    startTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStartTask = resolve;
        }),
    );
    const createTask = (key: string) =>
      app.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload: {},
        url: "/v1/projects/codexly/tasks",
      });

    const firstResponsePromise = createTask("in-flight-task-1");
    await vi.waitFor(() => {
      expect(startTask).toHaveBeenCalledTimes(1);
    });
    const repeatedResponsePromise = createTask("in-flight-task-1");
    const rejectedResponse = await createTask("in-flight-task-2");
    resolveStartTask(task);
    const [firstResponse, repeatedResponse] = await Promise.all([
      firstResponsePromise,
      repeatedResponsePromise,
    ]);

    expect(firstResponse.statusCode).toBe(201);
    expect(repeatedResponse.json()).toEqual(firstResponse.json());
    expect(rejectedResponse.statusCode).toBe(503);
    expect(rejectedResponse.json()).toEqual({
      code: "IDEMPOTENCY_CAPACITY_EXCEEDED",
      message: "Too many idempotent requests are in progress",
      retryable: true,
    });
    const nextResponse = await createTask("in-flight-task-2");
    expect(nextResponse.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledTimes(2);
  });

  it("rejects interruption for a terminal or unrelated turn", async () => {
    const { app, interruptTurn, readTask } = await createHarness();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [
        {
          completedAt: "2026-07-23T00:03:00.000Z",
          error: null,
          id: "turn-completed",
          items: [],
          startedAt: "2026-07-23T00:02:00.000Z",
          status: "completed" as const,
        },
      ],
    });
    const terminal = await app.inject({
      headers: { "idempotency-key": "terminal-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/codexly/tasks/task-1/turns/turn-completed/interrupt",
    });
    readTask.mockResolvedValueOnce(snapshot);
    const missing = await app.inject({
      headers: { "idempotency-key": "missing-turn" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/codexly/tasks/task-1/turns/turn-missing/interrupt",
    });

    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({ code: "TURN_NOT_RUNNING" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "TURN_NOT_FOUND" });
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("validates idempotency keys and rejects conflicting payloads", async () => {
    const { app, startTurn } = await createHarness();
    const missingKey = await app.inject({
      method: "POST",
      payload: {},
      url: "/v1/projects/codexly/tasks",
    });
    const first = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第一次"),
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });
    const conflict = await app.inject({
      headers: { "idempotency-key": "turn-conflict" },
      method: "POST",
      payload: turnRequest("第二次"),
      url: "/v1/projects/codexly/tasks/task-1/turns",
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      retryable: false,
    });
    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("preserves provider failures without caching them", async () => {
    const { app, startTask } = await createHarness();
    startTask.mockRejectedValueOnce(
      new RpcResponseError({ code: -32_000, data: null, message: "native RPC details" }),
    );
    const request = {
      headers: { "idempotency-key": "retry-task" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/codexly/tasks",
    };

    const failed = await app.inject(request);
    const retried = await app.inject(request);

    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "native RPC details",
      retryable: true,
    });
    expect(retried.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledTimes(2);
  });

  it("sanitizes non-Codex implementation failures in idempotent actions", async () => {
    const { app, startTask } = await createHarness();
    startTask.mockRejectedValueOnce(new Error("/private/database.sqlite is locked"));

    const response = await app.inject({
      headers: { "idempotency-key": "internal-failure" },
      method: "POST",
      payload: {
        input: { attachments: [], skills: [], text: "start", type: "prompt" },
        options: turnOptions,
      },
      url: "/v1/projects/codexly/tasks",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
    });
  });

  it("captures the checkpoint after reading a task snapshot", async () => {
    const harness = createProvider();
    const snapshotDuringRead = {
      ...snapshot,
      status: "running" as const,
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [
            {
              id: "item-1",
              role: "assistant" as const,
              text: "读取期间到达",
              type: "message" as const,
            },
          ],
          startedAt: "2026-07-23T00:01:00.000Z",
          status: "running" as const,
        },
      ],
    };
    const provider: AgentProvider = {
      ...harness.provider,
      readTask: vi.fn((taskId: string) => {
        harness.emitEvent({
          itemId: "item-1",
          payload: { delta: "读取期间到达" },
          taskId,
          turnId: "turn-1",
          type: "message.delta",
        });
        return Promise.resolve(snapshotDuringRead);
      }),
    };
    const app = await createCodexlyServer(createServerOptions(provider));
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1",
    });

    expect(response.json()).toMatchObject({
      checkpoint: { sequence: 1 },
      snapshot: snapshotDuringRead,
    });
  });
});
