import { describe, expect, it, vi } from "vitest";

import { runNpmWithRegistryFallback, withRegistryFallback } from "./npm-registry.js";

const official = "https://registry.npmjs.org";
const mirror = "https://registry.npmmirror.com";

describe("network-aware registry selection", () => {
  it.each([official, mirror])(
    "uses %s when its probe succeeds first and cancels the slower probe",
    async (fastest) => {
      let slowerSignal: AbortSignal | undefined;
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
        if (typeof url === "string" && url.startsWith(fastest))
          return Promise.resolve(new Response(null));
        slowerSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          slowerSignal?.addEventListener(
            "abort",
            () => {
              reject(new Error("probe cancelled"));
            },
            {
              once: true,
            },
          );
        });
      });
      const request = vi.fn((registry: string) => Promise.resolve(registry));

      await expect(withRegistryFallback(request)).resolves.toBe(fastest);
      expect(request).toHaveBeenCalledExactlyOnceWith(fastest);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
      expect(slowerSignal?.aborted).toBe(true);
    },
  );

  it.each([official, mirror])(
    "ignores a failed %s probe and uses the available source",
    async (failed) => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
        Promise.resolve(
          new Response(null, {
            status: typeof url === "string" && url.startsWith(failed) ? 503 : 200,
          }),
        ),
      );
      const available = failed === official ? mirror : official;
      await expect(withRegistryFallback((registry) => Promise.resolve(registry))).resolves.toBe(
        available,
      );
    },
  );

  it("uses official ordering when both probes fail", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("HEAD unavailable"));
    const request = vi.fn((registry: string) => Promise.resolve(registry));
    await expect(withRegistryFallback(request)).resolves.toBe(official);
  });

  it.each([official, mirror])(
    "falls back after downloading from the selected %s fails",
    async (selected) => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
        Promise.resolve(
          new Response(null, {
            status: typeof url === "string" && url.startsWith(selected) ? 200 : 503,
          }),
        ),
      );
      const request = vi.fn((registry: string) => {
        if (registry === selected) return Promise.reject(new Error("download failed"));
        return Promise.resolve(registry);
      });
      const fallback = selected === official ? mirror : official;
      await expect(withRegistryFallback(request)).resolves.toBe(fallback);
      expect(request.mock.calls).toEqual([[selected], [fallback]]);
    },
  );

  it("stops both probes and never downloads after user cancellation", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal ?? AbortSignal.abort();
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("probe cancelled"));
          },
          { once: true },
        );
      });
    });
    const request = vi.fn(() => Promise.resolve("downloaded"));
    const pending = withRegistryFallback(request, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(request).not.toHaveBeenCalled();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("bounds stalled probes and then attempts an official download", async () => {
    const timeout = new AbortController();
    const createTimeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal ?? AbortSignal.abort();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("probe cancelled"));
          },
          { once: true },
        );
      });
    });
    const request = vi.fn((registry: string) => Promise.resolve(registry));
    const pending = withRegistryFallback(request);
    timeout.abort(new DOMException("timed out", "TimeoutError"));
    await expect(pending).resolves.toBe(official);
    expect(createTimeout).toHaveBeenCalledWith(3_000);
    expect(request).toHaveBeenCalledExactlyOnceWith(official);
  });

  it("does not probe or download when already cancelled", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const request = vi.fn(() => Promise.resolve("downloaded"));
    await expect(
      withRegistryFallback(request, AbortSignal.abort(new Error("cancelled"))),
    ).rejects.toThrow("cancelled");
    expect(fetch).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not switch sources when cancellation interrupts the selected download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const controller = new AbortController();
    const request = vi.fn(() => {
      controller.abort(new Error("cancelled"));
      return Promise.reject(new Error("download interrupted"));
    });
    await expect(withRegistryFallback(request, controller.signal)).rejects.toThrow("cancelled");
    expect(request).toHaveBeenCalledOnce();
  });

  it("passes the selected registry to npm and both scoped dependencies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const runNpm = vi.fn(() => Promise.resolve("installed"));
    await runNpmWithRegistryFallback(runNpm, ["install", "--global", "@bryanhu/codexly"]);
    expect(runNpm).toHaveBeenCalledWith(
      expect.arrayContaining([
        `--registry=${official}`,
        `--@openai:registry=${official}`,
        `--@bryanhu:registry=${official}`,
      ]),
      {},
    );
  });
});
