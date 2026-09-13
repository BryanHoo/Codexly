import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

test("reads task navigation availability with one request", async () => {
  const response = { task: null };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(jsonResponse(response)));
  const client = new CodexlyClient({ fetch });

  await expect(client.readNavigableTask("project", "task-1")).resolves.toEqual(response);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[0]).toBe("/v1/projects/project/tasks/task-1/navigation");
  expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
});
