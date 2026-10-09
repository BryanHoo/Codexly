import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppUpdateService,
  installGlobalPackageSafely,
  resolveNpmInstallInvocation,
  type SafeGlobalInstallOptions,
} from "./app-update.js";
import type { RunNpmOptions } from "./npm-registry.js";

const mirror = "https://registry.npmmirror.com";
const official = "https://registry.npmjs.org";
const installedPackageRoot = "/installed/lib/node_modules/@bryanhu/codexly";

describe("app update registry selection", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
  });
  it("identifies release notes requests with the same User-Agent", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("## [1.4.0] - 2026-08-06\n\n### Added\n\n- Update notes.\n"));
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.162.0",
      fetchLatestVersion: () => Promise.resolve("1.4.0"),
    });

    await expect(service.read()).resolves.toMatchObject({ latestVersion: "1.4.0" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "user-agent": "Codexly" });
  });

  it("checks the official registry when its probe succeeds first", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ latest: "1.4.0" }));
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.162.0",
      fetchChangelog: () => Promise.resolve(""),
    });

    await expect(service.read()).resolves.toMatchObject({ latestVersion: "1.4.0" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[0]).toBe(`${official}/-/package/%40bryanhu%2Fcodexly/dist-tags`);
  });

  it.each(["network", "missing", "invalid", "timeout"])(
    "falls back to the official registry after a %s mirror failure",
    async (failure) => {
      let attempted = false;
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
        if (init?.method === "HEAD") {
          return Promise.resolve(
            new Response(null, {
              status: typeof url === "string" && url.startsWith(mirror) ? 200 : 503,
            }),
          );
        }
        if (!attempted) {
          attempted = true;
          if (failure === "network" || failure === "timeout")
            return Promise.reject(new Error(failure));
          return Promise.resolve(
            failure === "missing"
              ? new Response("", { status: 404 })
              : Response.json({ latest: "bad" }),
          );
        }
        return Promise.resolve(Response.json({ latest: "1.4.0" }));
      });
      const service = createAppUpdateService({
        appVersion: "1.3.0",
        codexVersion: "0.162.0",
        fetchChangelog: () => Promise.resolve(""),
      });

      await expect(service.read()).resolves.toMatchObject({ latestVersion: "1.4.0" });
      expect(
        fetch.mock.calls.filter(([, init]) => init?.method !== "HEAD").map(([url]) => url),
      ).toEqual([
        `${mirror}/-/package/%40bryanhu%2Fcodexly/dist-tags`,
        `${official}/-/package/%40bryanhu%2Fcodexly/dist-tags`,
      ]);
      for (const [, init] of fetch.mock.calls) {
        expect(init?.headers).toMatchObject({ "user-agent": "Codexly" });
      }
    },
  );

  it.each(["pack", "install"])(
    "retries failed remote %s with the official registry and revalidates stale cache metadata",
    async (failedCommand) => {
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
        Promise.resolve(
          new Response(null, {
            status: typeof url === "string" && url.startsWith(mirror) ? 200 : 503,
          }),
        ),
      );
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
        currentPackageRoot: installedPackageRoot,
        runNpm,
      });

      const commands = runNpm.mock.calls.map(([args]) => args);
      // 包下载和依赖安装复用同一组探测，不因切源重试再次探测。
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(commands[0]).not.toContain(`--registry=${mirror}`);
      const remote = commands.slice(1);
      for (const args of remote) {
        expect(args).not.toContain("--prefer-offline");
        expect(args).not.toContain("--prefer-online=false");
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
      installGlobalPackageSafely("1.4.0", { currentPackageRoot: installedPackageRoot, runNpm }),
    ).rejects.toThrow();
    expect(runNpm).toHaveBeenCalledTimes(2);
    expect(runNpm.mock.calls.some(([args]) => args[0] === "install")).toBe(false);
  });

  it("runs npm through sudo for an elevated Linux installation", () => {
    expect(resolveNpmInstallInvocation("1.4.0", "linux", "/usr/bin/node", true)).toEqual({
      args: ["--", "npm", "install", "--global", "@bryanhu/codexly@1.4.0"],
      command: "sudo",
    });
  });

  it("elevates replacement and rollback when the global package directory is not writable", async () => {
    const invocations: { args: readonly string[]; elevated: boolean }[] = [];
    let installAttempts = 0;
    const runNpm = vi.fn((args: readonly string[], options?: RunNpmOptions) => {
      invocations.push({
        args,
        elevated: options?.elevated === true,
      });
      if (args[0] === "install" && ++installAttempts <= 2) {
        return Promise.reject(new Error("replacement failed"));
      }
      return Promise.resolve(
        args[0] === "pack" ? JSON.stringify([{ filename: "codexly.tgz" }]) : "",
      );
    });
    const options: SafeGlobalInstallOptions = {
      currentPackageRoot: "/usr/lib/node_modules/@bryanhu/codexly",
      requiresElevation: () => Promise.resolve(true),
      runNpm,
    };

    await expect(installGlobalPackageSafely("1.4.0", options)).rejects.toThrow(
      "replacement failed",
    );

    const installs = invocations.filter(({ args }) => args[0] === "install");
    expect(installs).toHaveLength(3);
    expect(installs.every(({ elevated }) => elevated)).toBe(true);
    expect(
      invocations.filter(({ args }) => args[0] === "pack").every(({ elevated }) => !elevated),
    ).toBe(true);
  });
});
