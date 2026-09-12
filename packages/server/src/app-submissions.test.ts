import { describe, expect, it } from "vitest";
import { createHarness, turnRequest } from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("task submission use case", () => {
  const request = {
    method: "POST" as const,
    url: "/v1/projects/codexly/submissions",
    headers: { "idempotency-key": "submission-1" },
    payload: { type: "prompt", ...turnRequest("实现需求") },
  };

  it("resumes a prepared task and replays its result across server restarts", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const first = await createHarness({ submissionRepository: repository });
    first.writeTaskSettings.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await first.app.inject(request)).statusCode).toBe(502);
    await first.app.close();
    await repository.close();
    const reopened = await openRepository(root);
    const second = await createHarness({ submissionRepository: reopened });
    const resumed = await second.app.inject(request);
    expect(resumed.statusCode, resumed.body).toBe(201);
    expect(second.startTask).not.toHaveBeenCalled();
    expect(second.startTurn).toHaveBeenCalledOnce();
    await second.app.close();
    await reopened.close();
    const third = await createHarness({ submissionRepository: await openRepository(root) });
    expect((await third.app.inject(request)).json()).toEqual(resumed.json());
    expect(third.startTask).not.toHaveBeenCalled();
    expect(third.startTurn).not.toHaveBeenCalled();
  });

  it("creates and starts a task in one idempotent request", async () => {
    const { app, startTask, startTurn } = await createHarness();
    const [first, repeated] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(first.statusCode, first.body).toBe(201);
    expect(repeated.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      createdTask: { id: "task-1" },
      taskId: "task-1",
      turn: { id: "turn-1" },
      checkpoint: { sequence: 0 },
    });
    expect(startTask).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("retains the created task when settings fail before turn execution", async () => {
    const { app, startTask, startTurn, writeTaskSettings } = await createHarness();
    writeTaskSettings.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await app.inject(request)).statusCode).toBe(502);
    const retried = await app.inject(request);
    expect(retried.statusCode, retried.body).toBe(201);
    expect(startTask).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("does not repeat a turn whose Provider result is unknown", async () => {
    const { app, startTask, startTurn } = await createHarness();
    startTurn.mockRejectedValueOnce(new Error("connection closed after request"));
    expect((await app.inject(request)).statusCode).toBe(502);
    const retried = await app.inject(request);
    expect(retried.statusCode).toBe(409);
    expect(retried.json()).toMatchObject({ code: "SUBMISSION_OUTCOME_UNKNOWN", retryable: false });
    expect(startTask).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("rejects changed input on the same key even after a partial failure", async () => {
    const { app, writeTaskSettings, startTask } = await createHarness();
    writeTaskSettings.mockRejectedValueOnce(new Error("database unavailable"));
    await app.inject(request);
    const conflict = await app.inject({
      ...request,
      payload: { type: "prompt", ...turnRequest("其他需求") },
    });
    expect(conflict.statusCode).toBe(409);
    expect(startTask).toHaveBeenCalledOnce();
  });

  it("starts a review without browser-side task creation", async () => {
    const { app, startTask, startReview } = await createHarness();
    const response = await app.inject({
      ...request,
      payload: { type: "review", target: { type: "base_branch", branch: "main" } },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      createdTask: { id: "task-1" },
      turn: { id: "review-turn" },
    });
    expect(startTask).toHaveBeenCalledOnce();
    expect(startReview).toHaveBeenCalledWith("task-1", { type: "base_branch", branch: "main" });
  });

  it("validates settings and task scope before executing", async () => {
    const { app, startTask, startTurn } = await createHarness();
    const invalid = await app.inject({
      ...request,
      payload: { ...request.payload, options: { ...request.payload.options, model: "missing" } },
    });
    expect(invalid.statusCode).toBe(400);
    const missing = await app.inject({
      ...request,
      headers: { "idempotency-key": "missing" },
      url: "/v1/projects/missing/submissions",
    });
    expect(missing.statusCode).toBe(404);
    expect(startTask).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});
