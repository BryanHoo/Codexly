import { expect, test } from "vitest";
import { createHarness } from "./app-all.test-support.js";

const settings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};
const request = {
  headers: { "idempotency-key": "settings-and-defaults" },
  method: "PUT" as const,
  payload: { settings, fastMode: true },
  url: "/v1/projects/codexly/tasks/task-1/settings-and-defaults",
};

test("updates task settings and project defaults as one replayable intent", async () => {
  const { app, writeProjectDefaults, writeTaskSettings } = await createHarness();
  const response = await app.inject(request);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ settings, defaults: { ...settings, fastMode: true } });
  expect(writeTaskSettings).toHaveBeenCalledExactlyOnceWith("codexly", "task-1", settings);
  expect(writeProjectDefaults).toHaveBeenCalledExactlyOnceWith("codexly", {
    ...settings,
    fastMode: true,
  });
  expect((await app.inject(request)).json()).toEqual(response.json());
  expect(writeTaskSettings).toHaveBeenCalledOnce();
  expect(writeProjectDefaults).toHaveBeenCalledOnce();
});

test("validates the full intent before either settings write", async () => {
  const { app, writeProjectDefaults, writeTaskSettings } = await createHarness();
  const response = await app.inject({
    ...request,
    payload: { settings: { ...settings, model: "missing" }, fastMode: false },
  });
  expect(response.statusCode).toBe(400);
  expect(writeTaskSettings).not.toHaveBeenCalled();
  expect(writeProjectDefaults).not.toHaveBeenCalled();
});
