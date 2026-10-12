import { expect, it, vi } from "vitest";
import { createDeferredLanguageLoader } from "./deferred-language.js";

it("keeps fallback startup offline and coalesces language loading and registration", async () => {
  const load = vi.fn(() => Promise.resolve({ common: { title: "Settings" } }));
  const register = vi.fn();
  const ensure = createDeferredLanguageLoader(load, register);
  await ensure("zh-CN");
  expect(load).not.toHaveBeenCalled();
  await Promise.all([ensure("en"), ensure("en")]);
  await ensure("en");
  expect(load).toHaveBeenCalledOnce();
  expect(register).toHaveBeenCalledExactlyOnceWith("en", "common", { title: "Settings" });
});

it("allows retrying a failed language download", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ common: {} });
  const register = vi.fn();
  const ensure = createDeferredLanguageLoader(load, register);
  await expect(ensure("en")).rejects.toThrow("offline");
  await expect(ensure("en")).resolves.toBeUndefined();
  expect(register).toHaveBeenCalledOnce();
});
