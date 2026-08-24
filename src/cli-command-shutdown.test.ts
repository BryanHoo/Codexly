import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli shutdown and help", () => {
  it("uses distinct colors for information, success, warning, and error output", async () => {
    const successHarness = createHarness();
    await expect(runCli(["doctor"], { ...successHarness.options, color: true })).resolves.toBe(0);
    expect(successHarness.stdout.join("")).toContain("\u001B[32m[成功]\u001B[0m");

    const warningHarness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--lan"], {
      ...warningHarness.options,
      color: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(warningHarness.stderr.join("")).toContain("\u001B[33m[警告]\u001B[0m");
      expect(warningHarness.stdout.join("")).toContain("\u001B[36m[信息]\u001B[0m");
    });
    controller.abort();
    await expect(run).resolves.toBe(0);

    const errorHarness = createHarness();
    await expect(runCli(["unknown"], { ...errorHarness.options, color: true })).resolves.toBe(1);
    expect(errorHarness.stderr.join("")).toContain("\u001B[31m[错误]\u001B[0m");
  });

  it("closes SQLite and Codex when HTTP Server creation fails", async () => {
    const harness = createHarness({
      createServer: vi.fn(() => Promise.reject(new Error("server startup failed"))),
    });

    await expect(runCli(["start"], harness.options)).resolves.toBe(1);

    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.lifecycle).toEqual([
      "projects.create",
      "projects.synchronize",
      "provider.create",
      "database.close",
      "runtime.close",
    ]);
    expect(harness.stderr.join("")).toContain("server startup failed");
  });

  it("closes the runtime when closing the HTTP server fails", async () => {
    const serverClose = vi.fn(() => Promise.reject(new Error("server close failed")));
    const serverListen = vi.fn(() => Promise.resolve("http://127.0.0.1:3210"));
    const harness = createHarness({
      createServer: vi.fn(() =>
        Promise.resolve({
          close: serverClose,
          listen: serverListen,
        }),
      ),
    });
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.dependencies.openBrowser).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(run).resolves.toBe(1);
    expect(serverClose).toHaveBeenCalledOnce();
    expect(harness.databaseClose).toHaveBeenCalledOnce();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.stderr.join("")).toContain("server close failed");
  });

  it("prints complete English help and rejects unknown commands or missing option values", async () => {
    const helpHarness = createHarness();
    const unknownHarness = createHarness();
    const invalidHarness = createHarness();

    await expect(runCli(["--help"], helpHarness.options)).resolves.toBe(0);
    await expect(runCli(["unknown"], unknownHarness.options)).resolves.toBe(1);
    await expect(runCli(["doctor", "--codex-bin"], invalidHarness.options)).resolves.toBe(1);

    const help = helpHarness.stdout.join("");
    expect(help).toContain("Usage: code-agent [command] [options]");
    expect(help).toContain("start    Start the CodeAgent server and open the Web interface.");
    expect(help).toContain("doctor   Check whether the local CodeAgent runtime is ready.");
    expect(help).toContain("version  Print the installed CodeAgent version.");
    expect(help).toContain("--port <port>");
    expect(help).toContain("--lan");
    expect(help).toContain("--lan-password <password>");
    expect(help).toContain("--allowed-host <domain>");
    expect(help).toContain("--session-ttl <duration>");
    expect(help).toContain("--codex-bin <path>");
    expect(help).toContain("--codex-home <path>");
    expect(help).toContain("-h, --help");
    expect(help).toContain("Defaults to 3210.");
    expect(help).toContain("Automatically increases the port when it is occupied.");
    expect(help).toContain("Requires --lan.");
    expect(help).toContain(
      "Running code-agent without a command is equivalent to code-agent start.",
    );
    expect(unknownHarness.stderr.join("")).toContain("未知命令: unknown");
    expect(invalidHarness.stderr.join("")).toContain("选项缺少值: --codex-bin");
  });

  it("rejects the removed --project option", async () => {
    const harness = createHarness();

    await expect(
      runCli(["start", "--project", "/workspace/project"], harness.options),
    ).resolves.toBe(1);
    expect(harness.stderr.join("")).toContain("未知选项: --project");
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });
});
