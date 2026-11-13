import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

describe("runCli ports", () => {
  it("starts on a custom port and uses it for the browser URL", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start", "--port", "4567"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4567 });
    });
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4567");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:4567");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("increments the port until the HTTP server can listen", async () => {
    const harness = createHarness();
    const addressInUse = Object.assign(new Error("address already in use"), {
      code: "EADDRINUSE",
    });
    harness.serverListen
      .mockRejectedValueOnce(addressInUse)
      .mockRejectedValueOnce(addressInUse)
      .mockResolvedValueOnce("http://127.0.0.1:4569");
    const controller = new AbortController();
    const run = runCli(["start", "--port", "4567"], {
      ...harness.options,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenLastCalledWith({
        host: "127.0.0.1",
        port: 4569,
      });
    });
    expect(harness.serverListen.mock.calls).toEqual([
      [{ host: "127.0.0.1", port: 4567 }],
      [{ host: "127.0.0.1", port: 4568 }],
      [{ host: "127.0.0.1", port: 4569 }],
    ]);
    expect(harness.dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4569");
    expect(harness.stdout.join("")).toContain("访问地址: http://127.0.0.1:4569");
    expect(harness.stderr.join("")).toContain("端口 4567 已被占用，已自动切换到端口 4569");

    controller.abort();
    await expect(run).resolves.toBe(0);
  });

  it("does not retry unrelated listen errors or increment beyond the TCP port limit", async () => {
    const cases = [
      {
        error: Object.assign(new Error("permission denied"), { code: "EACCES" }),
        port: "4567",
      },
      {
        error: Object.assign(new Error("address already in use"), { code: "EADDRINUSE" }),
        port: "65535",
      },
    ];

    for (const testCase of cases) {
      const harness = createHarness();
      harness.serverListen.mockRejectedValueOnce(testCase.error);

      await expect(runCli(["start", "--port", testCase.port], harness.options)).resolves.toBe(1);
      expect(harness.serverListen).toHaveBeenCalledTimes(1);
      expect(harness.serverListen).toHaveBeenCalledWith({
        host: "127.0.0.1",
        port: Number(testCase.port),
      });
      expect(harness.stderr.join("")).toContain(testCase.error.message);
    }
  });

  it("keeps HTTP available when an individual ACP agent request fails", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });
    try {
      await vi.waitFor(() => {
        expect(harness.serverListen).toHaveBeenCalledOnce();
      });
      vi.spyOn(harness.runtimeProvider, "listModels").mockRejectedValueOnce(
        new Error("agent disconnected"),
      );
      await expect(harness.runtimeProvider.listModels()).rejects.toThrow("agent disconnected");
      expect(harness.serverClose).not.toHaveBeenCalled();
      expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    } finally {
      controller.abort();
    }
    await expect(run).resolves.toBe(0);
  });

  it("opens a new browser page without waiting for an existing page", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const run = runCli(["start"], { ...harness.options, signal: controller.signal });

    await vi.waitFor(() => {
      expect(harness.dependencies.openBrowser).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(run).resolves.toBe(0);
  });
});
