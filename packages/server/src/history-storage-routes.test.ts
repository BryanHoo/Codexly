import { expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

it("submits history compression idempotently and validates empty input", async () => {
  const compress = vi.fn(() => Promise.resolve({ status: "scheduled" as const }));
  const options = createServerOptions(createProvider().provider);
  const app = await createCodexlyServer({
    ...options,
    provider: { ...options.provider, historyStorage: { compress } },
  });
  closeCallbacks.push(() => app.close());
  const request = {
    method: "POST" as const,
    url: "/v1/history/compress",
    headers: { "idempotency-key": "compress-1" },
    payload: {},
  };
  expect((await app.inject(request)).json()).toEqual({ status: "scheduled" });
  expect((await app.inject(request)).json()).toEqual({ status: "scheduled" });
  expect(compress).toHaveBeenCalledTimes(1);
  expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(400);
  compress.mockRejectedValueOnce(new Error("unsupported store"));
  const failed = await app.inject({ ...request, headers: { "idempotency-key": "retry" } });
  expect(failed.statusCode).toBe(502);
  expect(failed.json()).not.toHaveProperty("status", "scheduled");
});
it("reports unavailable history maintenance without a provider", async () => {
  const app = await createCodexlyServer(createServerOptions(createProvider().provider));
  closeCallbacks.push(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/v1/history/compress",
    headers: { "idempotency-key": "unavailable" },
    payload: {},
  });
  expect(response.statusCode).toBe(503);
});
