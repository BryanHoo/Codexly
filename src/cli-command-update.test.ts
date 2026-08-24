import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { STARTUP_UPDATE_APPLIED_ENV } from "./cli-startup-update.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli updates", () => {
  it("asks about an available update and starts normally when the user declines", async () => {
    const confirmAppUpdate = vi.fn(() => Promise.resolve(false));
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: "1.3.0", status: "available" as const }),
      ),
      confirmAppUpdate,
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(confirmAppUpdate).toHaveBeenCalledWith("1.2.3", "1.3.0");
    expect(harness.dependencies.installAppUpdate).not.toHaveBeenCalled();
    expect(harness.dependencies.restartAfterUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("installs an accepted update and restarts with the original start arguments", async () => {
    const lifecycle: string[] = [];
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: "1.3.0", status: "available" as const }),
      ),
      confirmAppUpdate: vi.fn(() => Promise.resolve(true)),
      installAppUpdate: vi.fn(() => {
        lifecycle.push("update.install");
        return Promise.resolve();
      }),
      restartAfterUpdate: vi.fn((args) => {
        lifecycle.push("cli.restart");
        expect(args).toEqual(["start", "--port", "4567"]);
        return Promise.resolve(0);
      }),
    });

    await expect(runCli(["start", "--port", "4567"], harness.options)).resolves.toBe(0);

    expect(lifecycle).toEqual(["update.install", "cli.restart"]);
    expect(harness.dependencies.installAppUpdate).toHaveBeenCalledWith("1.3.0");
    expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.stdout.join("")).toContain("Codexly 已更新到 1.3.0");
  });

  it("skips the startup update check in the restarted process", async () => {
    vi.stubEnv(STARTUP_UPDATE_APPLIED_ENV, "1");
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.checkAppUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("warns and continues startup when the update check fails", async () => {
    const harness = createHarness({
      checkAppUpdate: vi.fn(() =>
        Promise.resolve({ latestVersion: null, status: "check-failed" as const }),
      ),
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(harness.stderr.join("")).toContain("无法检查 Codexly 更新");
    expect(harness.dependencies.confirmAppUpdate).not.toHaveBeenCalled();

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
