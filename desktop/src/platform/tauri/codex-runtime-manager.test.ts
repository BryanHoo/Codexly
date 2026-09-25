import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
let channelHandler: ((value: unknown) => void) | undefined;

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    public constructor(handler: (value: unknown) => void) {
      channelHandler = handler;
    }
  },
  invoke,
}));

describe("Codex runtime manager", () => {
  beforeEach(() => {
    invoke.mockReset();
    channelHandler = undefined;
  });

  it("reuses the validated installation result without a second native inspection", async () => {
    invoke
      .mockResolvedValueOnce({
        detectedVersion: null,
        requiredVersion: "0.156.0",
        status: "compatible",
      })
      .mockResolvedValueOnce({
        detectedVersion: "0.156.0",
        requiredVersion: "0.156.0",
        status: "compatible",
      });
    const { downloadAndInspectCodexRuntime } = await import("./codex-runtime-manager.js");

    const availability = await downloadAndInspectCodexRuntime();

    expect(availability.status).toBe("compatible");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "install_codex_runtime",
    ]);
  });

  it("forwards private runtime download progress from the native channel", async () => {
    invoke
      .mockImplementationOnce(async () => {
        channelHandler?.({ downloadedBytes: 25, sequence: 2, totalBytes: 100 });
        channelHandler?.({ downloadedBytes: 10, sequence: 1, totalBytes: 100 });
        return { status: "compatible" };
      })
      .mockResolvedValueOnce({ status: "compatible" });
    const { downloadAndInspectCodexRuntime } = await import("./codex-runtime-manager.js");
    const onProgress = vi.fn();

    await downloadAndInspectCodexRuntime(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({
      downloadedBytes: 25,
      sequence: 2,
      totalBytes: 100,
    });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "install_codex_runtime",
      expect.objectContaining({ onProgress: expect.anything() }),
    );
  });

  it("forwards automatic update progress while inspecting the runtime", async () => {
    invoke.mockImplementationOnce(async () => {
      channelHandler?.({
        currentVersion: "0.150.0",
        downloadedBytes: 42,
        phase: "downloading",
        sequence: 2,
        targetVersion: "0.156.0",
        totalBytes: 100,
      });
      channelHandler?.({
        currentVersion: "0.150.0",
        downloadedBytes: 10,
        phase: "downloading",
        sequence: 1,
        targetVersion: "0.156.0",
        totalBytes: 100,
      });
      return { status: "compatible" };
    });
    const { inspectCodexRuntime } = await import("./codex-runtime-manager.js");
    const onProgress = vi.fn();

    await inspectCodexRuntime(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "downloading", sequence: 2 }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "inspect_codex_runtime",
      expect.objectContaining({ onProgress: expect.anything() }),
    );
  });
});
