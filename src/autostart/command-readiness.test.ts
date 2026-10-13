import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAutostartCommand } from "./command.js";
import { getAutostartPaths } from "./config.js";
import { queryRuntime, readRuntimeState, stopManaged } from "./runtime.js";
import type * as RuntimeModule from "./runtime.js";
import { createTerminalOutput } from "../terminal-output.js";

const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn((ms: number) => {
    clock.now += ms;
    return Promise.resolve();
  }),
}));
vi.mock("./runtime.js", async (original) => ({
  ...(await original<typeof RuntimeModule>()),
  queryRuntime: vi.fn(),
  readRuntimeState: vi.fn(),
  stopManaged: vi.fn(() => Promise.resolve()),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("autostart readiness deadline", () => {
  async function restart(readyAfter: number) {
    const root = await mkdtemp(join(tmpdir(), "codexly-readiness-"));
    roots.push(root);
    clock.now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    // 仅推进管理命令的等待时间，不引入真实网络或长达数十秒的测试等待。
    vi.mocked(queryRuntime).mockImplementation(() =>
      Promise.resolve({
        pid: 123,
        startedAt: new Date(0).toISOString(),
        phase: clock.now >= readyAfter ? "ready" : "starting",
        lan: false,
        configHash: "test",
        ...(clock.now >= readyAfter ? { port: 43210 } : {}),
      }),
    );
    vi.mocked(readRuntimeState).mockResolvedValue(undefined);
    const messages: string[] = [];
    const write = (message: string) => messages.push(message);
    const result = runAutostartCommand(
      ["restart"],
      createTerminalOutput(write, write, false),
      vi.fn(),
      {
        platform: "darwin",
        paths: getAutostartPaths("darwin", root, {}),
        runtime: { node: process.execPath, cli: "/cli", home: root, cwd: root, environment: {} },
        validateInstallation: vi.fn(),
        adapter: {
          prepare: vi.fn(),
          install: vi.fn(),
          remove: vi.fn(),
          restart: vi.fn(() => Promise.resolve()),
          stop: vi.fn(),
          status: vi.fn(() => Promise.resolve({ enabled: true, detail: "test" })),
        },
      },
    );
    return { result, messages };
  }

  it("waits for a healthy cold startup taking longer than thirty seconds", async () => {
    const { result, messages } = await restart(39_000);
    await expect(result).resolves.toBe(0);
    expect(messages.join("")).toContain("后台服务已就绪：http://127.0.0.1:43210");
    expect(clock.now).toBe(39_000);
  });

  it("bounds startup waiting and leaves the background service available for diagnosis", async () => {
    const { result } = await restart(Infinity);
    await expect(result).rejects.toThrow("启动等待超过 120 秒");
    expect(clock.now).toBe(120_000);
    expect(stopManaged).toHaveBeenCalledOnce();
  });
});
