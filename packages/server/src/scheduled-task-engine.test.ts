import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CLAUDE_SETTINGS, type ScheduledTaskMutationResponse } from "@codexly/protocol";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

async function setup() {
  const harness = createProvider();
  const base = createServerOptions(harness.provider);
  const profile = {
    engine: "claude" as const,
    capabilities: { ...(await harness.provider.getCapabilities()), provider: "claude" },
    models: {
      data: [
        {
          id: "claude-sonnet",
          displayName: "Sonnet",
          description: "",
          isDefault: true,
          defaultReasoningEffort: "",
          supportedReasoningEfforts: [],
        },
      ],
      nextCursor: null,
    },
    commands: [],
    connection: {
      state: "connected" as const,
      mode: "custom" as const,
      account: null,
      customBaseUrl: null,
      pendingLogin: null,
    },
  };
  const inspect = vi.fn(() => Promise.resolve(profile));
  const app = await createCodexlyServer({
    ...base,
    provider: {
      ...base.provider,
      engines: {
        claude: {
          inspect,
          readSettings: () => Promise.resolve(DEFAULT_CLAUDE_SETTINGS),
          writeSettings: (settings) => Promise.resolve(settings),
          configure: () => Promise.resolve({ status: profile.connection, models: profile.models }),
          disconnect: () => Promise.resolve({ status: profile.connection }),
        },
      },
    },
  });
  closeCallbacks.push(() => app.close());
  const input = {
    enabled: false,
    messageAttachments: [],
    name: "Claude review",
    projectId: project.id,
    projectName: project.name,
    prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
    schedule: { type: "once", atUnixMs: Date.now() + 60_000 },
    turnOptions: {
      ...turnOptions,
      model: "claude-sonnet",
      reasoningEffort: "",
      engineOptions: { engine: "claude", permissionMode: "plan" },
    },
  };
  return { app, harness, inspect, input };
}

describe("scheduled task engine", () => {
  it("persists Claude options and uses its model catalog and engine when launching", async () => {
    const { app, harness, inspect, input } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks",
      headers: { "idempotency-key": "create" },
      payload: input,
    });
    expect(created.statusCode, created.body).toBe(201);
    const task = created.json<ScheduledTaskMutationResponse>().task;
    expect(task.turnOptions).toEqual(input.turnOptions);
    expect(inspect).toHaveBeenCalled();
    const started = await app.inject({
      method: "POST",
      url: `/v1/scheduled-tasks/${task.id}/run`,
      headers: { "idempotency-key": "run" },
    });
    expect(started.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(harness.startTurn).toHaveBeenCalledOnce();
    });
    expect(harness.startTask).toHaveBeenCalledWith({ engine: "claude" });
    expect(harness.startTurn.mock.calls[0]?.[2]).toEqual(input.turnOptions);
    const listed = await app.inject("/v1/scheduled-tasks");
    expect(listed.json()).toMatchObject({ data: [{ turnOptions: input.turnOptions }] });
  });

  it("rejects a model from the wrong engine before saving or creating a task", async () => {
    const { app, harness, input } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/scheduled-tasks",
      headers: { "idempotency-key": "invalid" },
      payload: { ...input, turnOptions: { ...input.turnOptions, model: turnOptions.model } },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect((await app.inject("/v1/scheduled-tasks")).json()).toEqual({ data: [] });
    expect(harness.startTask).not.toHaveBeenCalled();
  });
});

it("updates an existing Codex schedule to Claude and rejects invalid updates atomically", async () => {
  const { app, harness, input } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/v1/scheduled-tasks",
    headers: { "idempotency-key": "codex" },
    payload: { ...input, turnOptions },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<ScheduledTaskMutationResponse>().task.id;
  const updated = await app.inject({
    method: "PUT",
    url: `/v1/scheduled-tasks/${id}`,
    headers: { "idempotency-key": "claude" },
    payload: input,
  });
  expect(updated.statusCode, updated.body).toBe(200);
  const invalid = await app.inject({
    method: "PUT",
    url: `/v1/scheduled-tasks/${id}`,
    headers: { "idempotency-key": "invalid" },
    payload: { ...input, turnOptions: { ...input.turnOptions, model: "missing" } },
  });
  expect(invalid.statusCode).toBe(400);
  expect((await app.inject("/v1/scheduled-tasks")).json()).toMatchObject({
    data: [{ turnOptions: input.turnOptions }],
  });
  await app.inject({
    method: "POST",
    url: `/v1/scheduled-tasks/${id}/run`,
    headers: { "idempotency-key": "run" },
  });
  await vi.waitFor(() => {
    expect(harness.startTurn).toHaveBeenCalledOnce();
  });
  expect(harness.startTask).toHaveBeenCalledWith({ engine: "claude" });
});

it("automatically launches a due Claude schedule with the selected engine", async () => {
  const { app, harness, input } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/v1/scheduled-tasks",
    headers: { "idempotency-key": "automatic" },
    payload: { ...input, enabled: true, schedule: { type: "once", atUnixMs: Date.now() + 200 } },
  });
  expect(created.statusCode, created.body).toBe(201);
  await vi.waitFor(() => {
    expect(harness.startTurn).toHaveBeenCalledOnce();
  });
  expect(harness.startTask).toHaveBeenCalledWith({ engine: "claude" });
});

it("checks the Claude catalog again before launch if available models changed", async () => {
  const { app, harness, inspect, input } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/v1/scheduled-tasks",
    headers: { "idempotency-key": "create" },
    payload: input,
  });
  const id = created.json<ScheduledTaskMutationResponse>().task.id;
  const profile = await inspect();
  inspect.mockResolvedValue({ ...profile, models: { ...profile.models, data: [] } });
  await app.inject({
    method: "POST",
    url: `/v1/scheduled-tasks/${id}/run`,
    headers: { "idempotency-key": "run" },
  });
  await vi.waitFor(async () => {
    expect((await app.inject("/v1/scheduled-tasks")).json()).toMatchObject({
      data: [{ lastRunStatus: "failed" }],
    });
  });
  expect(harness.startTask).not.toHaveBeenCalled();
  expect(harness.startTurn).not.toHaveBeenCalled();
});
