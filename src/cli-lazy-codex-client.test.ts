import { expect, it, vi } from "vitest";
import { createHarness } from "./cli-command.test-support.js";
import { createLazyCodexClient, createLazyCodexRuntime } from "./cli-lazy-codex-client.js";

it("coalesces first requests and connects live subscriptions before dispatch", async () => {
  const { client } = createHarness();
  const notifications = vi.spyOn(client, "onNotification");
  const serverRequests = vi.spyOn(client, "onServerRequest");
  const ready = Promise.withResolvers<typeof client>();
  const initialize = vi.fn(() => ready.promise);
  const lazy = createLazyCodexClient(initialize);
  const listener = vi.fn(),
    removed = vi.fn(),
    serverRequest = vi.fn();
  lazy.onNotification(listener);
  const dispose = lazy.onNotification(removed);
  lazy.onServerRequest(serverRequest);
  dispose();
  expect(initialize).not.toHaveBeenCalled();
  vi.spyOn(client, "request").mockImplementation(() => {
    expect(notifications).toHaveBeenCalledWith(listener);
    expect(notifications).not.toHaveBeenCalledWith(removed);
    expect(serverRequests).toHaveBeenCalledWith(serverRequest);
    return Promise.resolve({ ok: true });
  });
  const requests = [lazy.request("first"), lazy.request("second")];
  expect(initialize).toHaveBeenCalledOnce();
  ready.resolve(client);
  await expect(Promise.all(requests)).resolves.toEqual([{ ok: true }, { ok: true }]);
  await lazy.request("third");
  expect(initialize).toHaveBeenCalledOnce();
});

it("allows retry after startup fails without losing notification subscriptions", async () => {
  const { client } = createHarness();
  const notifications = vi.spyOn(client, "onNotification");
  const initialize = vi
    .fn<() => Promise<typeof client>>()
    .mockRejectedValueOnce(new Error("missing executable"))
    .mockResolvedValue(client);
  const lazy = createLazyCodexClient(initialize);
  const listener = vi.fn();
  lazy.onNotification(listener);
  await expect(lazy.request("config/read")).rejects.toThrow("missing executable");
  expect(notifications).not.toHaveBeenCalled();
  await lazy.request("config/read");
  expect(initialize).toHaveBeenCalledTimes(2);
  expect(notifications).toHaveBeenCalledWith(listener);
});

it("waits for a handshake during shutdown and closes its runtime before returning", async () => {
  const harness = createHarness();
  const started = await harness.dependencies.startCodexAppServer();
  const ready = Promise.withResolvers<typeof started>();
  const prepare = vi.fn(() => Promise.resolve());
  const runtime = createLazyCodexRuntime(() => ready.promise, prepare);
  const request = runtime.client.request("config/read");
  const closing = runtime.close();
  expect(harness.close).not.toHaveBeenCalled();
  ready.resolve(started);
  await Promise.all([request, closing]);
  expect(prepare).toHaveBeenCalledWith(started.client);
  expect(harness.close).toHaveBeenCalledOnce();
});
