import { expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

it("sends reconciliation as an idempotent mutation and validates the response", async () => {
  const result = {
    changedPlugins: [],
    failedRemotePluginIds: ["failed"],
    failedMaterializationRemotePluginIds: [],
  };
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(result))));
  const client = new CodexlyClient({ baseUrl: "http://localhost", fetch });
  expect(await client.reconcileOfficialPlugins({ idempotencyKey: "sync-1" })).toEqual(result);
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://localhost/v1/plugins/official/reconcile");
  expect(options.method).toBe("POST");
  expect(new Headers(options.headers).get("idempotency-key")).toBe("sync-1");
  expect(options.body).toBe("{}");
});
