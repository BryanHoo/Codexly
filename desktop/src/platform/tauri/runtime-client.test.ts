import { beforeEach, describe, expect, it, vi } from "vitest";

let channelHandler: ((value: unknown) => void) | undefined;

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    public constructor(handler: (value: unknown) => void) {
      channelHandler = handler;
    }
  },
}));

import { type InvokeImplementation } from "./native-client.js";
import { TauriRuntimeClient } from "./runtime-client.js";

describe("TauriRuntimeClient", () => {
  beforeEach(() => {
    channelHandler = undefined;
  });

  it("installs app updates through native IPC and forwards monotonic progress", async () => {
    const invoke = vi.fn(async () => {
      channelHandler?.({ downloadedBytes: 25, sequence: 2, totalBytes: 100 });
      channelHandler?.({ downloadedBytes: 10, sequence: 1, totalBytes: 100 });
    });
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const onProgress = vi.fn();

    await client.installAppUpdate("0.2.0", { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({
      downloadedBytes: 25,
      sequence: 2,
      totalBytes: 100,
    });
    expect(invoke).toHaveBeenCalledWith(
      "install_app_update",
      expect.objectContaining({ onProgress: expect.anything(), version: "0.2.0" }),
    );
  });

  it("loads the Bing background through the native command", async () => {
    const invoke = vi.fn(async () => ({ assetPath: "/cache/bing.jpg" }));
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getWorkbenchBackground("2026-08-25")).resolves.toEqual({
      assetPath: "/cache/bing.jpg",
    });
    expect(invoke).toHaveBeenCalledWith("get_workbench_background", {
      day: "2026-08-25",
      thumbnail: false,
    });
  });

  it("reads runtime IPC performance metrics", async () => {
    const response = { projects: [], version: 1 as const };
    const invoke = vi.fn(async () => response);
    const client = new TauriRuntimeClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getPerformanceMetrics()).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith("get_runtime_performance_metrics");
  });

  it("lists history and saves an original without starting the agent runtime", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async (command: string) => command === "list_workbench_backgrounds" ? [] : { status: "cancelled" });
    const client = new TauriRuntimeClient({ ensureRuntime, invoke: invoke as InvokeImplementation });
    await expect(client.listWorkbenchBackgrounds()).resolves.toEqual([]);
    await expect(client.downloadWorkbenchBackground("2026-09-01")).resolves.toEqual({ status: "cancelled" });
    expect(invoke).toHaveBeenCalledWith("download_workbench_background", { day: "2026-09-01" });
    expect(ensureRuntime).not.toHaveBeenCalled();
  });
});
