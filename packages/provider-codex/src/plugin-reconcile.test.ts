import { describe, expect, it } from "vitest";
import { CodexRuntimeProvider } from "./runtime-provider.js";
import { FakeRpcClient } from "./agent-provider.test-support.js";

const result = {
  changedPlugins: [
    {
      id: "github@openai-curated-remote",
      hasApps: true,
      hasHooks: false,
      hasMcps: true,
      hasSkills: false,
    },
  ],
  failedRemotePluginIds: ["remote-failed"],
  failedMaterializationRemotePluginIds: ["remote-failed"],
};

describe("plugin reconciliation", () => {
  it("shares concurrent passes, preserves partial failures, and starts a fresh next pass", async () => {
    const pending = Promise.withResolvers<unknown>();
    const client = new FakeRpcClient([pending.promise, result]);
    const provider = new CodexRuntimeProvider(client);
    const first = provider.reconcileOfficialPlugins();
    const second = provider.reconcileOfficialPlugins();
    expect(client.calls).toEqual([
      { method: "plugin/reconcile", params: { reason: "codexly.refresh" } },
    ]);
    pending.resolve({ ...result, privateMetadata: "omit" });
    expect(await first).toEqual(result);
    expect(await second).toEqual(result);
    expect(await provider.reconcileOfficialPlugins()).toEqual(result);
    expect(client.calls).toHaveLength(2);
  });

  it("releases failed passes for retry", async () => {
    const client = new FakeRpcClient([new Error("offline"), result]);
    const provider = new CodexRuntimeProvider(client);
    await expect(provider.reconcileOfficialPlugins()).rejects.toThrow("offline");
    expect(await provider.reconcileOfficialPlugins()).toEqual(result);
  });

  it.each([
    {},
    {
      ...result,
      changedPlugins: [
        { id: "", hasApps: true, hasHooks: false, hasMcps: false, hasSkills: false },
      ],
    },
    {
      ...result,
      changedPlugins: [
        { id: "x", hasApps: "yes", hasHooks: false, hasMcps: true, hasSkills: false },
      ],
    },
    { ...result, failedRemotePluginIds: [42] },
  ])(
    "rejects malformed responses instead of reporting successful synchronization",
    async (response) => {
      const provider = new CodexRuntimeProvider(new FakeRpcClient([response]));
      await expect(provider.reconcileOfficialPlugins()).rejects.toThrow();
    },
  );
});
