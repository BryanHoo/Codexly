import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

test("sends one structured completed task query without a mutation key", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse({ data: [], nextCursor: null })));
  const client = new CodexlyClient({ fetch });
  const input = {
    projectIds: ["temporary", "codexly"],
    cursor: { temporary: null, codexly: "next" },
  };
  expect(await client.queryCompletedTasks(input)).toEqual({ data: [], nextCursor: null });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toBe("/v1/tasks/completed/query");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("idempotency-key")).toBe(false);
});
