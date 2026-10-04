import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks } from "./app.test-support.js";
import { createProvider } from "./app-provider.test-support.js";
import { createServerOptions } from "./app-options.test-support.js";

it("reconciles through an idempotent POST and retains partial failures", async () => {
  const result = {
    changedPlugins: [],
    failedRemotePluginIds: ["failed"],
    failedMaterializationRemotePluginIds: [],
  };
  const reconcileOfficialPlugins = vi.fn(() => Promise.resolve(result));
  const app = await createCodexlyServer(
    createServerOptions(createProvider().provider, {
      skillMarketService: { reconcileOfficialPlugins },
    }),
  );
  closeCallbacks.push(() => app.close());
  const request = {
    method: "POST" as const,
    url: "/v1/plugins/official/reconcile",
    headers: { "idempotency-key": "reconcile-a" },
    payload: {},
  };
  const first = await app.inject(request);
  expect(first.statusCode).toBe(200);
  expect(first.json()).toEqual(result);
  expect((await app.inject(request)).json()).toEqual(result);
  expect(reconcileOfficialPlugins).toHaveBeenCalledTimes(1);
  expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(400);
});
