import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("CLI instance ownership", () => {
  it("releases ownership after startup fails", async () => {
    const close = vi.fn(() => Promise.resolve());
    const harness = createHarness({
      acquireRuntimeLock: () => Promise.resolve({ close, signal: new AbortController().signal }),
      createStateRepository: () => Promise.reject(new Error("Database unavailable")),
    });
    expect(await runCli(["start"], harness.options)).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });
  it("rejects a second instance before opening state or starting Codex", async () => {
    const harness = createHarness();
    const acquireRuntimeLock = vi.fn(() => Promise.reject(new Error("Codexly is already running")));
    Object.assign(harness.dependencies, { acquireRuntimeLock });
    await expect(
      runCli(["start"], {
        ...harness.options,
        signal: AbortSignal.abort(),
      }),
    ).resolves.toBe(1);
    expect(acquireRuntimeLock).toHaveBeenCalledOnce();
    expect(harness.dependencies.createStateRepository).not.toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  });
});
