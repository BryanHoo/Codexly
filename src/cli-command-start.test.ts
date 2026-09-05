import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli startup", () => {
  it("prints the Codexly version", async () => {
    const harness = createHarness();

    await expect(runCli(["version"], harness.options)).resolves.toBe(0);
    expect(harness.stdout.join("")).toBe("codexly 1.2.3\n");
    expect(harness.stderr).toEqual([]);
  });

  it("checks Node.js, Codex, and SQLite diagnostics in doctor", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        ["doctor", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"],
        harness.options,
      ),
    ).resolves.toBe(0);
    expect(harness.dependencies.locateCodexBinary).toHaveBeenCalledWith({
      explicitPath: "/custom/codex",
    });
    expect(harness.dependencies.checkCodexVersion).toHaveBeenCalledWith("/fake/codex");
    expect(harness.stdout.join("")).toContain("[成功] Node.js 22.14.0");
    expect(harness.stdout.join("")).toContain("[成功] Codex 0.153.4 (/fake/codex)");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join("/custom/home", "codexly", "state.sqlite3"),
    );
    expect(harness.stdout.join("")).toContain("[成功] SQLite 可写");
    expect(harness.stdout.join("")).toContain("[成功] SQLite migration 4");
    expect(harness.stdout.join("")).toContain("[成功] SQLite integrity_check ok");
    expect(harness.stdout.join("")).toContain("[成功] SQLite journal_mode wal");
    expect(harness.databaseClose).toHaveBeenCalledOnce();
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.13.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("需要 Node.js 22.14.0 或更高版本");
    expect(harness.dependencies.locateCodexBinary).not.toHaveBeenCalled();
  });

  it("closes SQLite when doctor diagnostics fail", async () => {
    const harness = createHarness();
    harness.stateRepository.diagnose.mockRejectedValue(new Error("integrity unavailable"));

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("integrity unavailable");
  });

  it("starts Codex, HTTP, and static Web then closes on abort", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    const [startOptions] = vi.mocked(harness.dependencies.startCodexAppServer).mock.calls[0] ?? [];
    expect(startOptions).toMatchObject({
      appVersion: "1.2.3",
      binaryPath: "/custom/codex",
    });
    expect(startOptions).not.toHaveProperty("cwd");
    expect(startOptions?.env?.["CODEX_HOME"]).toBe("/custom/home");
    expect(harness.dependencies.createRuntimeProvider).toHaveBeenCalledWith({
      client: harness.client,
    });
    expect(harness.dependencies.createProjectRepository).toHaveBeenCalledWith({
      client: harness.client,
      projection: harness.stateRepository,
    });
    expect(harness.projectRepository.synchronize).toHaveBeenCalledOnce();
    const [serverOptions] = vi.mocked(harness.dependencies.createServer).mock.calls[0] ?? [];
    expect(serverOptions).toMatchObject({
      projectRepository: harness.projectRepository,
      providerConnectionRepository: harness.stateRepository,
      provider: harness.runtimeProvider,
      settingsRepository: harness.stateRepository,
      staticRoot: "/package/dist/web",
      standaloneCwd: process.cwd(),
    });
    expect(typeof serverOptions?.installAppUpdate).toBe("function");
    expect(typeof serverOptions?.readAppInfo).toBe("function");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join("/custom/home", "codexly", "state.sqlite3"),
    );
    expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");
    expect(harness.stdout.join("")).toContain("[成功] Codexly 已启动");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:3210");

    controller.abort();

    await expect(run).resolves.toBe(0);
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.serverClose).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual([
      "projects.create",
      "projects.synchronize",
      "provider.create",
      "server.create",
      "server.listen",
      "browser.open",
      "server.close",
      "database.close",
      "runtime.close",
    ]);
  });

  it("stops startup and cleans resources when Codex project synchronization fails", async () => {
    const harness = createHarness();
    harness.projectRepository.synchronize.mockRejectedValue(new Error("project sync failed"));

    await expect(runCli(["start"], harness.options)).resolves.toBe(1);

    expect(harness.dependencies.createServer).not.toHaveBeenCalled();
    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual(["projects.create", "database.close", "runtime.close"]);
    expect(harness.stderr.join("")).toContain("project sync failed");
  });

  it("migrates legacy projects before synchronization and only then marks migration complete", async () => {
    const harness = createHarness();
    harness.stateRepository.readProjectSourceMigration.mockResolvedValue({
      completed: false,
      recoverUnassigned: true,
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    expect(harness.projectRepository.migrateLegacyProjects).toHaveBeenCalledWith({
      recoverUnassigned: true,
    });
    expect(harness.lifecycle.slice(0, 5)).toEqual([
      "projects.create",
      "projects.migrate",
      "projects.synchronize",
      "projects.migration.complete",
      "provider.create",
    ]);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("defaults to start when no command is provided", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli([], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 3210 });
    });
    expect(harness.dependencies.startCodexAppServer).toHaveBeenCalledOnce();
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
