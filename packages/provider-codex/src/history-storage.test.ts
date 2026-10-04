import { expect, it } from "vitest";
import { CodexRuntimeProvider } from "./runtime-provider.js";
import { FakeRpcClient } from "./agent-provider.test-support.js";

it("requests one pending compression pass without claiming completion or changing config", async () => {
  const pending = Promise.withResolvers<unknown>();
  const client = new FakeRpcClient([pending.promise, {}]);
  const provider = new CodexRuntimeProvider(client);
  const first = provider.historyStorage.compress();
  const second = provider.historyStorage.compress();
  expect(client.calls).toEqual([{ method: "rollout/compress", params: undefined }]);
  pending.resolve({});
  expect(await first).toEqual({ status: "scheduled" });
  expect(await second).toEqual({ status: "scheduled" });
  expect(await provider.historyStorage.compress()).toEqual({ status: "scheduled" });
  expect(client.calls).toHaveLength(2);
});
it("propagates an unsupported store error and permits retry", async () => {
  const provider = new CodexRuntimeProvider(new FakeRpcClient([new Error("unsupported"), {}]));
  await expect(provider.historyStorage.compress()).rejects.toThrow("unsupported");
  expect(await provider.historyStorage.compress()).toEqual({ status: "scheduled" });
});
it.each([null, [], "", 1].map((value) => ({ value })))(
  "rejects invalid compression acknowledgement $value",
  async ({ value }) => {
    const provider = new CodexRuntimeProvider(new FakeRpcClient([value]));
    await expect(provider.historyStorage.compress()).rejects.toThrow();
  },
);
