import { describe, expect, it, vi } from "vitest";
import type { AppUpdateProgress } from "@codexly/protocol";

import {
  createAppUpdateService,
  extractVersionReleaseNotes,
  installGlobalPackageSafely,
  isNewerVersion,
  resolveNpmInstallInvocation,
} from "./app-update.js";

describe("app update service", () => {
  it("extracts only the requested version from the project changelog", () => {
    expect(
      extractVersionReleaseNotes(
        "# 更新日志\n\n## [Unreleased]\n\n## [1.4.0] - 2026-08-06\n\n### 新增\n\n- 添加在线更新。\n\n## [1.3.0] - 2026-08-05\n\n- 旧版本。\n",
        "1.4.0",
      ),
    ).toBe("### 新增\n\n- 添加在线更新。");
  });

  it("compares semantic versions without numeric precision loss", () => {
    expect(isNewerVersion("9007199254740993.0.0", "9007199254740992.0.0")).toBe(true);
    expect(isNewerVersion("1.4.0-beta.10", "1.4.0-beta.2")).toBe(true);
    expect(isNewerVersion("1.4.0-beta.01", "1.4.0-beta.1")).toBe(false);
  });

  it("runs npm through node.exe on Windows without a command shell", () => {
    expect(
      resolveNpmInstallInvocation("1.4.0", "win32", String.raw`C:\Program Files\nodejs\node.exe`),
    ).toEqual({
      args: [
        String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`,
        "install",
        "--global",
        "@bryanhu/codexly@1.4.0",
      ],
      command: String.raw`C:\Program Files\nodejs\node.exe`,
    });
  });

  it("restores the installed package from a local backup when replacement fails", async () => {
    const commands: string[][] = [];
    const progress: string[] = [];
    const runNpm = vi.fn((args: readonly string[]) => {
      commands.push([...args]);
      if (args[0] === "pack") {
        const source = args.at(-1) ?? "";
        return Promise.resolve(
          JSON.stringify([
            {
              filename: source.includes("@bryanhu/codexly@1.4.0")
                ? "bryanhu-codexly-1.4.0.tgz"
                : "bryanhu-codexly-1.3.0.tgz",
            },
          ]),
        );
      }
      if (args[0] === "install" && args.at(-1)?.endsWith("1.4.0.tgz") === true) {
        return Promise.reject(new Error("interrupted"));
      }
      return Promise.resolve("");
    });

    await expect(
      installGlobalPackageSafely("1.4.0", {
        currentPackageRoot: "/installed/codexly",
        onProgress: (update) => {
          progress.push(`${update.phase}:${String(update.percent)}`);
        },
        runNpm,
      }),
    ).rejects.toThrow("interrupted");

    expect(commands.map((args) => [args[0], args.at(-1)])).toEqual([
      ["pack", "/installed/codexly"],
      ["pack", "@bryanhu/codexly@1.4.0"],
      ["install", expect.stringMatching(/bryanhu-codexly-1\.4\.0\.tgz$/u)],
      ["install", expect.stringMatching(/bryanhu-codexly-1\.3\.0\.tgz$/u)],
    ]);
    expect(progress).toEqual([
      "backing-up:10",
      "downloading:30",
      "installing:80",
      "rolling-back:90",
    ]);
  });

  it("exposes current progress while an application update is running", async () => {
    let finishInstall!: () => void;
    const runNpmInstall = vi.fn(
      (_version: string, onProgress?: (progress: AppUpdateProgress) => void) => {
        onProgress?.({ percent: 30, phase: "downloading" });
        return new Promise<void>((resolve) => {
          finishInstall = resolve;
        });
      },
    );
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchLatestVersion: vi.fn(() => Promise.resolve("1.4.0")),
      runNpmInstall,
    });

    await expect(service.readProgress()).resolves.toEqual({ progress: null });
    const install = service.install("1.4.0");
    await vi.waitFor(() => {
      expect(runNpmInstall).toHaveBeenCalledOnce();
    });
    await expect(service.readProgress()).resolves.toEqual({
      progress: { percent: 30, phase: "downloading" },
    });

    finishInstall();
    await install;
    await expect(service.readProgress()).resolves.toEqual({
      progress: { percent: 100, phase: "completed" },
    });
  });

  it("reports a newer validated registry version", async () => {
    const fetchLatestVersion = vi.fn(() => Promise.resolve("1.4.0"));
    const runNpmInstall = vi.fn(() => Promise.resolve());
    const fetchChangelog = vi.fn(() =>
      Promise.resolve("## [1.4.0] - 2026-08-06\n\n### 新增\n\n- 添加在线更新。\n"),
    );
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchLatestVersion,
      fetchChangelog,
      runNpmInstall,
    });

    await expect(service.read()).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: "1.4.0",
      releaseNotes: "### 新增\n\n- 添加在线更新。",
      status: "available",
      updateAvailable: true,
    });
    expect(runNpmInstall).not.toHaveBeenCalled();
    expect(fetchChangelog).toHaveBeenCalledWith("1.4.0");
  });

  it("returns version information when the registry check fails", async () => {
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchLatestVersion: vi.fn(() => Promise.reject(new Error("offline"))),
      runNpmInstall: vi.fn(),
    });

    await expect(service.read()).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: null,
      releaseNotes: null,
      status: "check-failed",
      updateAvailable: false,
    });
  });

  it.each([401, 404])(
    "treats registry status %i for an unpublished initial package as current",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not published", { status }));
      const service = createAppUpdateService({
        appVersion: "0.1.0",
        codexVersion: "0.153.4",
        runNpmInstall: vi.fn(),
      });

      await expect(service.read()).resolves.toEqual({
        appVersion: "0.1.0",
        codexVersion: "0.153.4",
        latestVersion: "0.1.0",
        releaseNotes: null,
        status: "current",
        updateAvailable: false,
      });
    },
  );

  it("keeps the available update when release notes cannot be loaded", async () => {
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchChangelog: vi.fn(() => Promise.reject(new Error("offline"))),
      fetchLatestVersion: vi.fn(() => Promise.resolve("1.4.0")),
      runNpmInstall: vi.fn(),
    });

    await expect(service.read()).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: "1.4.0",
      releaseNotes: null,
      status: "available",
      updateAvailable: true,
    });
  });

  it("installs only the current validated latest version", async () => {
    const runNpmInstall = vi.fn(() => Promise.resolve());
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchLatestVersion: vi.fn(() => Promise.resolve("1.4.0")),
      runNpmInstall,
    });

    await expect(service.install("1.4.0")).resolves.toEqual({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      latestVersion: "1.4.0",
      releaseNotes: null,
      status: "restart-required",
      updateAvailable: false,
    });
    expect(runNpmInstall).toHaveBeenCalledWith("1.4.0", expect.any(Function));

    await expect(service.install("1.5.0")).rejects.toMatchObject({
      code: "UPDATE_NOT_AVAILABLE",
    });
  });

  it("installs the newest release when the registry advances after a check", async () => {
    const runNpmInstall = vi.fn(() => Promise.resolve());
    const fetchLatestVersion = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("1.4.0")
      .mockResolvedValueOnce("1.5.0");
    const service = createAppUpdateService({
      appVersion: "1.3.0",
      codexVersion: "0.153.4",
      fetchChangelog: vi.fn(() => Promise.resolve("")),
      fetchLatestVersion,
      runNpmInstall,
    });

    await expect(service.read()).resolves.toMatchObject({
      latestVersion: "1.4.0",
      status: "available",
    });
    await expect(service.install("1.4.0")).resolves.toMatchObject({
      latestVersion: "1.5.0",
      status: "restart-required",
    });
    expect(runNpmInstall).toHaveBeenCalledWith("1.5.0", expect.any(Function));
  });
});
