import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTaskPage, ScheduledTaskMutationResponse } from "@codexly/protocol";
import { createCodexlyServer } from "./app.js";
import { AttachmentStore } from "./attachment-store.js";
import { createMemorySubmissionRepository } from "./task-submission-service.js";
import { createMemoryScheduledTaskRepository } from "./scheduled-task-service.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const harness = createProvider();
  const repository = createMemoryScheduledTaskRepository();
  const submissions = createMemorySubmissionRepository(100);
  const options = createServerOptions(harness.provider, {
    scheduledTaskRepository: repository,
    submissionRepository: submissions,
  });
  const app = await createCodexlyServer(options);
  closeCallbacks.push(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/v1/scheduled-tasks",
    headers: { "idempotency-key": "create" },
    payload: {
      enabled: false,
      messageAttachments: [],
      name: "Review",
      projectId: project.id,
      projectName: project.name,
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      schedule: { type: "once", atUnixMs: Date.now() + 60_000 },
      turnOptions,
    },
  });
  expect(response.statusCode).toBe(201);
  const id = response.json<ScheduledTaskMutationResponse>().task.id;
  const run = () =>
    app.inject({
      method: "POST",
      url: `/v1/scheduled-tasks/${id}/run`,
      headers: { "idempotency-key": "run" },
    });
  return { app, harness, id, options, repository, submissions, run };
}

describe("durable scheduled submissions", () => {
  it("retains the known task id if saving the created task fails", async () => {
    const state = await setup();
    const write = state.submissions.writeSubmission.bind(state.submissions);
    vi.spyOn(state.submissions, "writeSubmission").mockImplementation((projectId, key, record) =>
      record.stage === "ready"
        ? Promise.reject(new Error("write failed"))
        : write(projectId, key, record),
    );
    await state.run();
    await vi.waitFor(async () => {
      const task = (await state.repository.listScheduledTasks())[0];
      expect(task?.lastRunStatus).toBe("unknown");
      expect(task?.runs[0]?.taskId).toEqual(expect.any(String));
    });
    expect(state.harness.startTurn).not.toHaveBeenCalled();
  });
  it("retries only the known result when the first started record cannot be written", async () => {
    const state = await setup();
    const write = state.submissions.writeSubmission.bind(state.submissions);
    let failed = false;
    vi.spyOn(state.submissions, "writeSubmission").mockImplementation((projectId, key, record) => {
      if (!failed && record.stage === "started") {
        failed = true;
        return Promise.reject(new Error("temporary write failure"));
      }
      return write(projectId, key, record);
    });
    await state.run();
    await vi.waitFor(async () => {
      expect((await state.repository.listScheduledTasks())[0]?.lastRunStatus).toBe(
        "cleanup_pending",
      );
    });
    await vi.waitFor(
      async () => {
        expect((await state.repository.listScheduledTasks())[0]?.lastRunStatus).toBe("started");
      },
      { timeout: 4_000 },
    );
    expect(state.harness.startTask).toHaveBeenCalledOnce();
    expect(state.harness.startTurn).toHaveBeenCalledOnce();
  });
  it("retries cleanup after restart without starting another task or turn", async () => {
    const state = await setup();
    const consume = vi
      .spyOn(AttachmentStore.prototype, "consume")
      .mockRejectedValue(new Error("cleanup failed"));
    expect((await state.run()).statusCode).toBe(200);
    await vi.waitFor(async () => {
      expect((await state.repository.listScheduledTasks())[0]?.lastRunStatus).toBe(
        "cleanup_pending",
      );
    });
    const run = (await state.repository.listScheduledTasks())[0]?.runs[0];
    if (run === undefined) throw new Error("Expected run");
    expect(run.taskId).not.toBeNull();
    expect((await state.submissions.readSubmission(project.id, `scheduled:${run.id}`))?.stage).toBe(
      "started",
    );
    await state.app.close();
    consume.mockRestore();
    const stored = (await state.repository.listScheduledTasks())[0];
    if (stored === undefined) throw new Error("Expected schedule");
    // 模拟启动结果已落库，但运行快照仍停留在 running 时崩溃。
    await state.repository.replaceScheduledTasks([
      {
        ...stored,
        lastRunStatus: "running",
        runs: stored.runs.map((item) => ({ ...item, status: "running", taskId: null })),
      },
    ]);
    const restarted = await createCodexlyServer(state.options);
    closeCallbacks.push(() => restarted.close());
    await vi.waitFor(
      async () => {
        const response = await restarted.inject("/v1/scheduled-tasks");
        expect(response.json<ScheduledTaskPage>().data[0]?.lastRunStatus).toBe("started");
      },
      { timeout: 4_000 },
    );
    expect(state.harness.startTask).toHaveBeenCalledOnce();
    expect(state.harness.startTurn).toHaveBeenCalledOnce();
  });

  it("preserves the created task and blocks duplicate launches after an ambiguous turn failure", async () => {
    const state = await setup();
    state.harness.startTurn.mockRejectedValue(new Error("connection lost"));
    await state.run();
    await vi.waitFor(async () => {
      expect((await state.repository.listScheduledTasks())[0]?.lastRunStatus).toBe("unknown");
    });
    const run = (await state.repository.listScheduledTasks())[0]?.runs[0];
    if (run === undefined) throw new Error("Expected run");
    expect(run.taskId).not.toBeNull();
    const retry = await state.app.inject({
      method: "POST",
      url: `/v1/scheduled-tasks/${state.id}/run`,
      headers: { "idempotency-key": "new-key" },
    });
    expect(retry.statusCode).toBe(409);
    expect(state.harness.startTurn).toHaveBeenCalledOnce();
  });
});
