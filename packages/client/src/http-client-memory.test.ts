import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

it("编码会话身份并传递取消信号，保留正常空摘要", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ status: "ready", summary: null }));
  const client = new CodexlyClient({ fetch: fetchMock });
  const controller = new AbortController();
  await expect(
    client.readThreadMemory("project one", "task/one", { signal: controller.signal }),
  ).resolves.toEqual({ status: "ready", summary: null });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/tasks/task%2Fone/memory");
  const signal = fetchMock.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  controller.abort();
  expect(signal?.aborted).toBe(true);
});
