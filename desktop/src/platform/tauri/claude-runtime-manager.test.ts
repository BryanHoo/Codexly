import { beforeEach, expect, it, vi } from "vitest";
const invoke = vi.fn();
let channelHandler: ((value: unknown) => void) | undefined;
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class { constructor(handler: (value: unknown) => void) { channelHandler = handler; } },
  invoke,
}));
beforeEach(() => { invoke.mockReset(); channelHandler = undefined; });
it("prepares Claude independently and forwards only ordered progress", async () => {
  invoke.mockImplementation(async () => {
    channelHandler?.({ phase: "downloading", sequence: 2, downloadedBytes: 25, totalBytes: 100 });
    channelHandler?.({ phase: "downloading", sequence: 1, downloadedBytes: 10, totalBytes: 100 });
  });
  const { prepareClaudeRuntime } = await import("./claude-runtime-manager.js");
  const onProgress = vi.fn();
  await prepareClaudeRuntime(onProgress);
  expect(invoke).toHaveBeenCalledWith("prepare_claude_runtime", expect.objectContaining({ onProgress: expect.anything() }));
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ downloadedBytes: 25 }));
});
it("propagates installation failure and allows a later retry", async () => {
  invoke.mockRejectedValueOnce(new Error("download failed")).mockResolvedValueOnce(null);
  const { prepareClaudeRuntime } = await import("./claude-runtime-manager.js");
  await expect(prepareClaudeRuntime()).rejects.toThrow("download failed");
  await expect(prepareClaudeRuntime()).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(2);
});
