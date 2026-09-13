import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

test("sends one typed archived deletion request for project and temporary scopes", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse({ deletedCount: 2, failedCount: 1 })));
  const client = new CodexlyClient({ fetch });
  expect(await client.deleteArchivedTasks("codexly", { idempotencyKey: "bulk" })).toEqual({
    deletedCount: 2,
    failedCount: 1,
  });
  await client.deleteArchivedTasks("temporary", { idempotencyKey: "temporary-bulk" });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/v1/projects/codexly/tasks/archived",
    "/v1/temporary/tasks/archived",
  ]);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE", body: "{}" });
});
