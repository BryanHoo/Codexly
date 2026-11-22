import { homedir } from "node:os";
import { join } from "node:path";
import { AppInfoResponseSchema } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli startup", () => {
  it("serves Web with the ACP runtime", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--no-open"], { ...harness.options, signal: controller.signal });
    try {
      await vi.waitFor(() => {
        expect(harness.serverListen).toHaveBeenCalledOnce();
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
      const appInfo = await vi
        .mocked(harness.dependencies.createServer)
        .mock.calls[0]?.[0].readAppInfo?.();
      expect(appInfo).toMatchObject({
        codexVersion: "0.166.0",
        claudeVersion: "2.1.316",
        status: "check-failed",
      });
      expect(appInfo?.codexVersion).toMatch(
        new RegExp(AppInfoResponseSchema.properties.codexVersion.pattern ?? "(?!)"),
      );
      expect(
        vi.mocked(harness.dependencies.createServer).mock.calls[0]?.[0].preloadModelCatalog,
      ).not.toBe(true);
    } finally {
      controller.abort();
      await run;
    }
    await expect(run).resolves.toBe(0);
  });
  it("prints the Codexly version", async () => {
    const harness = createHarness();

    await expect(runCli(["version"], harness.options)).resolves.toBe(0);
    expect(harness.stdout.join("")).toBe("codexly 1.2.3\n");
    expect(harness.stderr).toEqual([]);
  });

  it("checks Node.js, both ACP agents and SQLite diagnostics in doctor", async () => {
    const harness = createHarness();

    await expect(
      runCli(
        ["doctor", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"],
        harness.options,
      ),
    ).resolves.toBe(0);
    expect(harness.dependencies.inspectAcpAgents).toHaveBeenCalledWith(
      expect.objectContaining({ CODEX_PATH: "/custom/codex", CODEX_HOME: "/custom/home" }),
    );
    expect(harness.stdout.join("")).toContain("[成功] Node.js 24.19.0");
    expect(harness.stdout.join("")).toContain("[成功] ACP codex 协议 v1 (codex-acp)");
    expect(harness.stdout.join("")).toContain("[成功] ACP claude 协议 v1 (claude-acp)");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join(homedir(), ".codexly", "state.sqlite3"),
      "/custom/home",
    );
    expect(harness.stdout.join("")).toContain("[成功] SQLite 可写");
    expect(harness.stdout.join("")).toContain("[成功] SQLite migration 4");
    expect(harness.stdout.join("")).toContain("[成功] SQLite integrity_check ok");
    expect(harness.stdout.join("")).toContain("[成功] SQLite journal_mode wal");
    expect(harness.databaseClose).toHaveBeenCalledOnce();
  });

  it("reports configuration failures before opening SQLite", async () => {
    const harness = createHarness({
      inspectAcpAgents: vi.fn(() =>
        Promise.reject(new Error("configLoad /home/config.toml:3:5 TOML parse error")),
      ),
    });
    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("configLoad /home/config.toml:3:5");
    expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.14.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("需要 Node.js 24.0.0 或更高版本");
  });

  it("closes SQLite when doctor diagnostics fail", async () => {
    const harness = createHarness();
    harness.stateRepository.diagnose.mockRejectedValue(new Error("integrity unavailable"));

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("integrity unavailable");
  });

  it("starts HTTP with the shared ACP runtime without launching either agent and closes on abort", async () => {
    const harness = createHarness();
    const readSettings = vi.spyOn(harness.stateRepository, "readGlobalSettings");
    const controller = new AbortController();
    const run = runCli(["start", "--codex-bin", "/custom/codex", "--codex-home", "/custom/home"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    const runtimeInput = vi.mocked(harness.dependencies.createAcpRuntime).mock.calls[0]?.[0];
    expect(runtimeInput).toMatchObject({
      store: harness.stateRepository,
      environment: expect.objectContaining({
        CODEX_HOME: "/custom/home",
        CODEX_PATH: "/custom/codex",
      }) as unknown,
    });
    expect(readSettings).not.toHaveBeenCalled();
    expect(harness.dependencies.createProjectRepository).toHaveBeenCalledWith({
      projection: harness.stateRepository,
    });
    expect(harness.projectRepository.synchronize).toHaveBeenCalledOnce();
    const [serverOptions] = vi.mocked(harness.dependencies.createServer).mock.calls[0] ?? [];
    expect(serverOptions).toMatchObject({
      projectRepository: harness.projectRepository,
      providerConnectionRepository: harness.stateRepository,
      provider: harness.runtimeProvider,
      preloadModelCatalog: false,
      settingsRepository: harness.stateRepository,
      staticRoot: "/package/dist/web",
      standaloneCwd: homedir(),
    });
    expect(typeof serverOptions?.installAppUpdate).toBe("function");
    expect(typeof serverOptions?.readAppInfo).toBe("function");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join(homedir(), ".codexly", "state.sqlite3"),
      "/custom/home",
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
      "runtime.close",
      "database.close",
    ]);
  });

  it("passes configured workspace roots to the server", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(
      ["start", "--workspace", "/workspace/apps", "--workspace", "/workspace/libs"],
      { ...harness.options, signal: controller.signal },
    );

    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    const [serverOptions] = vi.mocked(harness.dependencies.createServer).mock.calls[0] ?? [];
    expect(serverOptions?.workspaceRoots).toEqual(["/workspace/apps", "/workspace/libs"]);

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("stops startup and cleans resources when Codex project synchronization fails", async () => {
    const harness = createHarness();
    harness.projectRepository.synchronize.mockRejectedValue(new Error("project sync failed"));

    await expect(runCli(["start"], harness.options)).resolves.toBe(1);

    expect(harness.dependencies.createServer).not.toHaveBeenCalled();
    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.lifecycle).toEqual(["projects.create", "database.close"]);
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
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
