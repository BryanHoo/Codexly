import { describe, expect, it, vi } from "vitest";
import samples from "../test/fixtures/startup-config.json" with { type: "json" };
import { readCodexStartupConfig, CodexStartupConfigError } from "./startup-config.js";

const execute = (value: unknown, exitCode = 0) =>
  vi.fn(() => Promise.resolve({ stdout: JSON.stringify(value), exitCode }));

describe("readCodexStartupConfig", () => {
  it("uses a one-shot command with the selected home, cwd and client identity", async () => {
    const run = execute(samples.success);
    const env = { CODEX_HOME: "/isolated/home", PATH: "/runtime/bin" };
    await expect(
      readCodexStartupConfig("/codex", { execute: run, env, cwd: "/project", appVersion: "1.2.3" }),
    ).resolves.toEqual(samples.success);
    expect(run).toHaveBeenCalledWith(
      "/codex",
      [
        "app-server",
        "--enable",
        "plugins",
        "--print-startup-config",
        "--startup-client-info",
        JSON.stringify({ name: "codexly", title: "Codexly", version: "1.2.3" }),
      ],
      expect.objectContaining({
        env,
        cwd: "/project",
        timeout: 10_000,
        maxBuffer: 1_048_576,
        killSignal: "SIGKILL",
        windowsHide: true,
      }),
    );
  });

  it.each(["configError", "policyError"] as const)(
    "preserves structured %s on a non-zero exit",
    async (key) => {
      const error = await readCodexStartupConfig("/codex", {
        execute: execute(samples[key], 1),
      }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(CodexStartupConfigError);
      expect(error).toMatchObject({ error: samples[key].error });
      expect(String(error)).toContain(samples[key].error.data.reason);
      expect(String(error)).toContain(samples[key].error.data.detail);
      if (key === "configError") expect(String(error)).toContain("/test/.codex/config.toml:1:10");
    },
  );

  it.each([
    {},
    { appServerVersion: "0.164.0" },
    { error: { message: "bad" } },
    { ...samples.success, error: samples.configError.error },
    { ...samples.success, configRequirements: { requirements: [] } },
  ])("rejects malformed envelopes", async (value) => {
    await expect(readCodexStartupConfig("/codex", { execute: execute(value) })).rejects.toThrow(
      "预检输出无效",
    );
  });

  it("does not treat a failed exit with a success envelope as ready", async () => {
    await expect(
      readCodexStartupConfig("/codex", { execute: execute(samples.success, 1) }),
    ).rejects.toThrow("预检进程退出");
  });

  it("bounds output and preserves process failures without echoing arbitrary stdout", async () => {
    await expect(
      readCodexStartupConfig("/codex", {
        execute: vi.fn(() => Promise.resolve({ stdout: "x".repeat(1_048_577), exitCode: 0 })),
      }),
    ).rejects.toThrow("预检输出超过");
    await expect(
      readCodexStartupConfig("/codex", {
        execute: vi.fn(() => Promise.resolve({ stdout: "secret invalid JSON", exitCode: 0 })),
      }),
    ).rejects.toThrow("预检输出无效");
    await expect(
      readCodexStartupConfig("/codex", {
        execute: vi.fn(() => Promise.reject(new Error("timeout"))),
      }),
    ).rejects.toThrow("预检执行失败");
  });
});
