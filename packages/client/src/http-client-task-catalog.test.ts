import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

test("reads a catalog once and forwards cancellation for both scope paths", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse({ data: [] })));
  const client = new CodexlyClient({ fetch });
  const signal = new AbortController().signal;
  expect(await client.listTaskCatalog("codexly", { pinned: true }, { signal })).toEqual({
    data: [],
  });
  await client.listTaskCatalog("temporary");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/v1/projects/codexly/tasks/catalog?pinned=true",
    "/v1/temporary/tasks/catalog",
  ]);
  expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});
