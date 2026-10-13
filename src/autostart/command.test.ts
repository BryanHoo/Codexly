import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAutostartPaths, readConfig, type AutostartConfig } from "./config.js";
import { runAutostartCommand } from "./command.js";
import { createTerminalOutput } from "../terminal-output.js";
import { runManaged, stopManaged } from "./runtime.js";
import { waitForAbort } from "../cli-shutdown.js";
import type { PlatformAdapter } from "./platform.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codexly-command-"));
  roots.push(root);
  const paths = getAutostartPaths("linux", root, {});
  const stdout: string[] = [];
  const adapter: PlatformAdapter = {
    prepare: vi.fn((config: AutostartConfig) => Promise.resolve(config)),
    install: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve({ enabled: true, detail: "test" })),
  };
  const output = createTerminalOutput(
    (s) => stdout.push(s),
    (s) => stdout.push(s),
    false,
  );
  const context = {
    paths,
    platform: "linux" as const,
    adapter,
    runtime: {
      node: process.execPath,
      cli: "/global/dist/cli.js",
      home: root,
      cwd: root,
      environment: {},
    },
    validateInstallation: vi.fn(() => Promise.resolve()),
  };
  const start = vi.fn(() => Promise.resolve(0));
  return { paths, adapter, output, stdout, context, start };
}
describe("autostart commands", () => {
  it("enables once without starting a runtime and only reveals credentials explicitly", async () => {
    const f = await fixture();
    await runAutostartCommand(["enable", "--lan", "--port", "4321"], f.output, f.start, f.context);
    const first = await readConfig(f.paths.config);
    expect(first?.start.port).toBe(4321);
    expect(f.adapter.restart).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    expect(f.stdout.join("")).not.toContain(first?.start.lanPassword);
    await runAutostartCommand(["enable", "--lan"], f.output, f.start, f.context);
    expect((await readConfig(f.paths.config))?.start.lanPassword).toBe(first?.start.lanPassword);
    await runAutostartCommand(["credentials"], f.output, f.start, f.context);
    expect(f.stdout.join("")).toContain(first?.start.lanPassword);
  });
  it("rolls back a failed registration to the previous usable configuration", async () => {
    const f = await fixture();
    await runAutostartCommand(["enable"], f.output, f.start, f.context);
    const previous = await readFile(f.paths.config, "utf8");
    vi.mocked(f.adapter.install).mockRejectedValueOnce(new Error("registration failed"));
    await expect(
      runAutostartCommand(["enable", "--lan"], f.output, f.start, f.context),
    ).rejects.toThrow("registration failed");
    expect(await readFile(f.paths.config, "utf8")).toBe(previous);
    expect(f.adapter.install).toHaveBeenCalledTimes(3);
  });
  it("repairs paths without losing saved mode or credentials", async () => {
    const f = await fixture();
    await runAutostartCommand(["enable", "--lan"], f.output, f.start, f.context);
    const previous = await readConfig(f.paths.config);
    f.context.runtime.node = "/new/node";
    await runAutostartCommand(["repair"], f.output, f.start, f.context);
    const next = await readConfig(f.paths.config);
    expect(next?.node).toBe("/new/node");
    expect(next?.start).toEqual(previous?.start);
  });
  it("validates options before modifying registration and supports nested help", async () => {
    const f = await fixture();
    await expect(
      runAutostartCommand(["enable", "--lan-password", "bad"], f.output, f.start, f.context),
    ).rejects.toThrow();
    await expect(
      runAutostartCommand(["status", "--now"], f.output, f.start, f.context),
    ).rejects.toThrow();
    await runAutostartCommand(["enable", "--help"], f.output, f.start, f.context);
    expect(f.stdout.join("")).toContain("--now");
    expect(f.adapter.install).not.toHaveBeenCalled();
  });
  it("disables the service without starting Codex and retains recoverable credentials", async () => {
    const f = await fixture();
    await runAutostartCommand(["enable", "--lan"], f.output, f.start, f.context);
    await runAutostartCommand(["disable"], f.output, f.start, f.context);
    expect(f.adapter.remove).toHaveBeenCalledOnce();
    expect((await readConfig(f.paths.config))?.start.lan).toBe(true);
    expect(f.start).not.toHaveBeenCalled();
  });
  it("starts --now, reports the actual port and applies a saved mode change only on restart", async () => {
    const f = await fixture();
    let running: Promise<number> | undefined;
    vi.mocked(f.adapter.restart).mockImplementation(async () => {
      const config = await readConfig(f.paths.config);
      if (!config) throw new Error("missing test configuration");
      running = runManaged(config, f.paths, async (context) => {
        await context.onReady({ host: "0.0.0.0", port: 4333 });
        await waitForAbort(context.signal);
        return 0;
      });
    });
    try {
      await runAutostartCommand(["enable", "--lan", "--now"], f.output, f.start, f.context);
      expect(f.stdout.join("")).toContain("4333");
      await runAutostartCommand(["enable"], f.output, f.start, f.context);
      await runAutostartCommand(["status"], f.output, f.start, f.context);
      expect(f.stdout.join("")).toContain("保存的配置尚未应用");
      expect(f.stdout.join("")).toContain("运行模式: LAN");
      await runAutostartCommand(["disable"], f.output, f.start, f.context);
      await expect(running).resolves.toBe(0);
    } finally {
      await stopManaged(f.paths);
      await running;
    }
  });
  it("removes a partial first registration when the system rejects installation", async () => {
    const f = await fixture();
    vi.mocked(f.adapter.install).mockRejectedValueOnce(new Error("denied"));
    await expect(runAutostartCommand(["enable"], f.output, f.start, f.context)).rejects.toThrow(
      "denied",
    );
    expect(await readConfig(f.paths.config)).toBeUndefined();
    expect(f.adapter.remove).toHaveBeenCalledOnce();
  });
  it("surfaces failed rollback and preserves its errors", async () => {
    const f = await fixture();
    vi.mocked(f.adapter.install).mockRejectedValueOnce(new Error("denied"));
    vi.mocked(f.adapter.remove).mockRejectedValueOnce(new Error("cleanup denied"));
    await expect(runAutostartCommand(["enable"], f.output, f.start, f.context)).rejects.toThrow(
      "回滚未完成",
    );
  });
  it.each([
    ["enable", "--workspace", "--now", "/workspace"],
    ["enable", "--now", "--now"],
    ["enable", "--allowed-host", "https://example.com"],
    ["repair", "--lan"],
    ["enable", "--port", "65536"],
  ])("rejects malformed options: %j", async (...args) => {
    const f = await fixture();
    await expect(runAutostartCommand(args, f.output, f.start, f.context)).rejects.toThrow();
    expect(f.adapter.install).not.toHaveBeenCalled();
  });
});
