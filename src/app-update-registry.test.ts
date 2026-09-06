import { describe, expect, it, vi } from "vitest";

import { createAppUpdateService, installGlobalPackageSafely } from "./app-update.js";

const mirror = "https://registry.npmmirror.com";
const official = "https://registry.npmjs.org";

describe("app update registry selection", () => {
  it("checks the mirror first without contacting the official registry on success", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ latest: "1.4.0" }));
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchChangelog: () => Promise.resolve(""),
    });

    await expect(service.read()).resolves.toMatchObject({ latestVersion: "1.4.0" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(`${mirror}/-/package/%40bryanhu%2Fcodexly/dist-tags`);
  });

  it.each(["network", "missing", "invalid", "timeout"])(
    "falls back to the official registry after a %s mirror failure",
    async (failure) => {
      const fetch = vi.spyOn(globalThis, "fetch");
      if (failure === "network" || failure === "timeout") {
        fetch.mockRejectedValueOnce(new Error(failure));
      } else {
        fetch.mockResolvedValueOnce(
          failure === "missing"
            ? new Response("", { status: 404 })
            : Response.json({ latest: "bad" }),
        );
      }
      fetch.mockResolvedValueOnce(Response.json({ latest: "1.4.0" }));
      const service = createAppUpdateService({
        appVersion: "1.3.0",
        codexVersion: "0.153.4",
        fetchChangelog: () => Promise.resolve(""),
      });

      await expect(service.read()).resolves.toMatchObject({ latestVersion: "1.4.0" });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${mirror}/-/package/%40bryanhu%2Fcodexly/dist-tags`,
        `${official}/-/package/%40bryanhu%2Fcodexly/dist-tags`,
      ]);
    },
  );

  it.each(["pack", "install"])(
    "retries failed remote %s with the official registry and shares npm cache",
    async (failedCommand) => {
      const runNpm = vi.fn((args: readonly string[]) => {
        const isRemote = args[0] === "install" || args.at(-1)?.startsWith("@bryanhu/");
        if (isRemote && args[0] === failedCommand && args.includes(`--registry=${mirror}`)) {
          return Promise.reject(new Error("mirror unavailable"));
        }
        return Promise.resolve(
          args[0] === "pack" ? JSON.stringify([{ filename: "codexly.tgz" }]) : "",
        );
      });

      await installGlobalPackageSafely("1.4.0", {
        currentPackageRoot: "/installed/codexly",
        runNpm,
      });

      const commands = runNpm.mock.calls.map(([args]) => args);
      expect(commands[0]).not.toContain(`--registry=${mirror}`);
      const remote = commands.slice(1);
      for (const args of remote) {
        expect(args).toContain("--prefer-offline");
        expect(args.some((arg) => arg.startsWith("--cache"))).toBe(false);
      }
      expect(
        remote
          .filter((args) => args[0] === failedCommand)
          .map((args) => args.find((arg) => arg.startsWith("--registry="))),
      ).toEqual([`--registry=${mirror}`, `--registry=${official}`]);
    },
  );

  it("does not retry or replace the installation after cancellation during download", async () => {
    const runNpm = vi.fn((args: readonly string[]) => {
      if (args.at(-1)?.startsWith("@bryanhu/")) {
        process.emit("SIGINT");
        return Promise.reject(new Error("cancelled"));
      }
      return Promise.resolve(JSON.stringify([{ filename: "backup.tgz" }]));
    });

    await expect(
      installGlobalPackageSafely("1.4.0", { currentPackageRoot: "/installed/codexly", runNpm }),
    ).rejects.toThrow();
    expect(runNpm).toHaveBeenCalledTimes(2);
    expect(runNpm.mock.calls.some(([args]) => args[0] === "install")).toBe(false);
  });
});
