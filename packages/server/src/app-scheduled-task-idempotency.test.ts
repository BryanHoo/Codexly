import type { ScheduledTask } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

async function setup() {
  let records: readonly ScheduledTask[] = [];
  const repository = {
    listScheduledTasks: () => Promise.resolve(records),
    replaceScheduledTasks: vi.fn((tasks: readonly ScheduledTask[]) => {
      records = [...tasks];
      return Promise.resolve(records);
    }),
  };
  const provider = createProvider();
  const options = createServerOptions(provider.provider, { scheduledTaskRepository: repository });
  const app = await createCodexlyServer(options);
  closeCallbacks.push(() => app.close());
  const input = {
    enabled: false,
    messageAttachments: [],
    name: "Review",
    projectId: project.id,
    projectName: project.name,
    prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
    schedule: { atUnixMs: Date.now() + 3_600_000, type: "once" },
    turnOptions,
  };
  const create = (key: string) =>
    app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks",
      payload: input,
      headers: { "idempotency-key": key },
    });
  return { app, create, input, options, repository, ...provider };
}

describe("scheduled task request idempotency", () => {
  it("coalesces concurrent creates, replays results and rejects changed payloads", async () => {
    const { app, create, input, repository } = await setup();
    const [first, concurrent] = await Promise.all([create("create"), create("create")]);
    expect(first.statusCode).toBe(201);
    expect(concurrent.json()).toEqual(first.json());
    expect((await create("create")).json()).toEqual(first.json());
    expect(repository.replaceScheduledTasks).toHaveBeenCalledTimes(1);
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks",
      payload: { ...input, name: "Changed" },
      headers: { "idempotency-key": "create" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(repository.replaceScheduledTasks).toHaveBeenCalledTimes(1);
  });

  it("replays run acceptance after execution completes without starting another Agent", async () => {
    const { app, create, startTask, startTurn } = await setup();
    const created = await create("shared");
    const taskId = created.json<{ task: ScheduledTask }>().task.id;
    const request = {
      method: "POST" as const,
      url: `/v1/scheduled-tasks/${taskId}/run`,
      headers: { "idempotency-key": "shared" },
    };
    const [first, concurrent] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(first.statusCode).toBe(200);
    expect(concurrent.json()).toEqual(first.json());
    await vi.waitFor(async () => {
      const listed = await app.inject({ method: "GET", url: "/v1/scheduled-tasks" });
      expect(listed.json<{ data: ScheduledTask[] }>().data[0]?.lastRunStatus).toBe("started");
    });
    expect((await app.inject(request)).json()).toEqual(first.json());
    expect(startTask).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it.each(["PUT", "PATCH", "DELETE"] as const)(
    "replays %s without another write and isolates tasks",
    async (method) => {
      const { app, create, input, repository } = await setup();
      const firstTask = (await create("first")).json<{ task: ScheduledTask }>().task;
      const secondTask = (await create("second")).json<{ task: ScheduledTask }>().task;
      repository.replaceScheduledTasks.mockClear();
      const request = (taskId: string) => ({
        method,
        url: `/v1/scheduled-tasks/${taskId}${method === "PATCH" ? "/enabled" : ""}`,
        headers: { "idempotency-key": "mutation" },
        ...(method === "DELETE"
          ? {}
          : { payload: method === "PATCH" ? { enabled: true } : { ...input, name: "Updated" } }),
      });
      const first = await app.inject(request(firstTask.id));
      expect(first.statusCode).toBe(200);
      expect((await app.inject(request(firstTask.id))).json()).toEqual(first.json());
      expect(repository.replaceScheduledTasks).toHaveBeenCalledOnce();
      expect((await app.inject(request(secondTask.id))).statusCode).toBe(200);
      expect(repository.replaceScheduledTasks).toHaveBeenCalledTimes(2);
      if (method !== "DELETE") {
        const conflict = await app.inject({
          ...request(firstTask.id),
          payload: method === "PATCH" ? { enabled: false } : input,
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      }
    },
  );

  it("requires nonempty keys on all write routes and preserves not-found errors", async () => {
    const { app, input } = await setup();
    const requests = [
      { method: "POST" as const, url: "/v1/scheduled-tasks", payload: input },
      { method: "PUT" as const, url: "/v1/scheduled-tasks/missing", payload: input },
      {
        method: "PATCH" as const,
        url: "/v1/scheduled-tasks/missing/enabled",
        payload: { enabled: true },
      },
      { method: "DELETE" as const, url: "/v1/scheduled-tasks/missing" },
      { method: "POST" as const, url: "/v1/scheduled-tasks/missing/run" },
    ];
    for (const request of requests) {
      expect((await app.inject(request)).statusCode).toBe(400);
      expect(
        (await app.inject({ ...request, headers: { "idempotency-key": "" } })).statusCode,
      ).toBe(400);
    }
    const missing = await app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks/missing/run",
      headers: { "idempotency-key": "missing" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("does not retain idempotency results across server instances sharing persisted tasks", async () => {
    const { app, create, input, options } = await setup();
    const first = await create("restart");
    await app.close();
    const restarted = await createCodexlyServer(options);
    closeCallbacks.push(() => restarted.close());
    const second = await restarted.inject({
      method: "POST",
      url: "/v1/scheduled-tasks",
      payload: input,
      headers: { "idempotency-key": "restart" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ task: ScheduledTask }>().task.id).not.toBe(
      first.json<{ task: ScheduledTask }>().task.id,
    );
    expect(
      (await restarted.inject({ method: "GET", url: "/v1/scheduled-tasks" })).json<{
        data: ScheduledTask[];
      }>().data,
    ).toHaveLength(2);
  });
});
