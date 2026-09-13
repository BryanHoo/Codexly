import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

const settings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};

test("sends task settings and project defaults as one mutation", async () => {
  const response = { settings, defaults: { ...settings, fastMode: true } };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse(response)));
  const client = new CodexlyClient({ fetch });
  expect(
    await client.updateTaskSettingsAndDefaults(
      "codexly",
      "task-1",
      { settings, fastMode: true },
      { idempotencyKey: "combined" },
    ),
  ).toEqual(response);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toBe("/v1/projects/codexly/tasks/task-1/settings-and-defaults");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    body: JSON.stringify({ settings, fastMode: true }),
    method: "PUT",
  });
});
