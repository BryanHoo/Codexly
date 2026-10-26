import { homedir } from "node:os";
import { join } from "node:path";
import { AppInfoResponseSchema, DEFAULT_GENERATION_MODEL } from "@codexly/protocol";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli startup", () => {
  it("serves Web without locating or starting an unavailable Codex executable", async () => {
    const harness = createHarness({
      startCodexAppServer: vi.fn(() => Promise.reject(new Error("Codex unavailable"))),
    });
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
      const sdkManifest = JSON.parse(
        await readFile(
          new URL("./package.json", import.meta.resolve("@anthropic-ai/claude-agent-sdk")),
          "utf8",
        ),
      ) as { claudeCodeVersion: string };
      expect(appInfo).toMatchObject({
        codexVersion: "0.164.0",
        claudeVersion: sdkManifest.claudeCodeVersion,
        status: "check-failed",
      });
      expect(appInfo?.codexVersion).toMatch(
        new RegExp(AppInfoResponseSchema.properties.codexVersion.pattern ?? "(?!)"),
      );
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
      expect(harness.dependencies.locateCodexBinary).not.toHaveBeenCalled();
      expect(harness.dependencies.readCodexStartupConfig).not.toHaveBeenCalled();
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
    expect(harness.stdout.join("")).toContain("[成功] Node.js 24.19.0");
    expect(harness.stdout.join("")).toContain("[成功] Codex 0.163.0 (/fake/codex)");
    expect(harness.dependencies.createStateRepository).toHaveBeenCalledWith(
      join(homedir(), ".codexly", "state.sqlite3"),
      "/custom/home",
    );
    expect(harness.dependencies.readCodexStartupConfig).toHaveBeenCalledWith("/fake/codex", {
      appVersion: "1.2.3",
      env: expect.objectContaining({ CODEX_HOME: "/custom/home" }) as NodeJS.ProcessEnv,
    });
    expect(harness.stdout.join("")).toContain("Codex 配置预检通过");
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.stdout.join("")).toContain("[成功] SQLite 可写");
    expect(harness.stdout.join("")).toContain("[成功] SQLite migration 4");
    expect(harness.stdout.join("")).toContain("[成功] SQLite integrity_check ok");
    expect(harness.stdout.join("")).toContain("[成功] SQLite journal_mode wal");
    expect(harness.databaseClose).toHaveBeenCalledOnce();
  });

  it("reports configuration failures before opening SQLite", async () => {
    const harness = createHarness({
      readCodexStartupConfig: vi.fn(() =>
        Promise.reject(new Error("configLoad /home/config.toml:3:5 TOML parse error")),
      ),
    });
    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("configLoad /home/config.toml:3:5");
    expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });

  it("returns a non-zero code when doctor finds an unsupported Node.js", async () => {
    const harness = createHarness({ nodeVersion: "22.14.0" });

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("需要 Node.js 24.0.0 或更高版本");
    expect(harness.dependencies.locateCodexBinary).not.toHaveBeenCalled();
  });

  it("closes SQLite when doctor diagnostics fail", async () => {
    const harness = createHarness();
    harness.stateRepository.diagnose.mockRejectedValue(new Error("integrity unavailable"));

    await expect(runCli(["doctor"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("integrity unavailable");
  });

  it("starts HTTP first and starts Codex on its first RPC then closes on abort", async () => {
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
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    const runtimeInput = vi.mocked(harness.dependencies.createRuntimeProvider).mock.calls[0]?.[0];
    await runtimeInput?.client.request("config/read");
    const [startOptions] = vi.mocked(harness.dependencies.startCodexAppServer).mock.calls[0] ?? [];
    expect(startOptions).toMatchObject({
      appVersion: "1.2.3",
      binaryPath: "/custom/codex",
    });
    expect(startOptions?.cwd).toBe(homedir());
    expect(startOptions?.env?.["CODEX_HOME"]).toBe("/custom/home");
    expect(harness.dependencies.createRuntimeProvider).toHaveBeenCalledWith({
      client: runtimeInput?.client,
      codexHome: "/custom/home",
      modelCatalogRuntimeFactory: expect.any(Function) as unknown,
      readTaskTitleModel: expect.any(Function) as unknown,
    });
    const [runtimeOptions] =
      vi.mocked(harness.dependencies.createRuntimeProvider).mock.calls[0] ?? [];
    expect(readSettings).not.toHaveBeenCalled();
    await expect(runtimeOptions?.readTaskTitleModel()).resolves.toBe(DEFAULT_GENERATION_MODEL);
    expect(harness.dependencies.createProjectRepository).toHaveBeenCalledWith({
      client: runtimeInput?.client,
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
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:3210");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
