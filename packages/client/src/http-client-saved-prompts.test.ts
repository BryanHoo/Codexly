import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

test("sends prompt mutations with application authentication and an idempotency key", async () => {
  const prompt = { id: "id", name: "检查", content: "正文" };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([prompt]));
  const client = new CodexlyClient({ fetch: fetchMock });
  expect(await client.syncSavedPrompts({ action: "save", prompt })).toEqual([prompt]);
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe("/v1/saved-prompts");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(new Headers(init?.headers).get("idempotency-key")).toBeTruthy();
  expect(init?.body).toBe(JSON.stringify({ action: "save", prompt }));
});
