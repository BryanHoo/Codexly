import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";
const preferences = {
  defaultAgent: "codex",
  defaultModel: null,
  commitMessagePrompt: "",
  taskTitlePrompt: "",
  promptOptimizationPrompt: "",
  defaultOpenAppId: null,
  followUpBehavior: "queue",
  pet: { enabled: false, selectedPetId: null },
};
it("应用偏好使用独立端口与字段补丁，严格解码且保留取消和幂等传输", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(preferences)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...preferences, defaultAgent: "claude", defaultModel: "raw/model" }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...preferences, model: "legacy" })));
  const client = new CodexlyClient({ baseUrl: "https://example.test", fetch });
  const signal = new AbortController().signal;
  expect(await client.getApplicationPreferences({ signal })).toEqual(preferences);
  const patch = { defaultAgent: "claude" as const, defaultModel: "raw/model" };
  await client.patchApplicationPreferences(patch, { signal, idempotencyKey: "stable" });
  expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/v1/application-preferences");
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify(patch) });
  await expect(client.getApplicationPreferences()).rejects.toThrow();
});
