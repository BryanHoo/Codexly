import { expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

it("本地目录直接交付 ACP 工厂，不创建旧 RPC 客户端，退出关闭应用仓储", async () => {
  const harness = createHarness();
  const controller = new AbortController();
  const run = runCli(["start", "--no-open"], { ...harness.options, signal: controller.signal });
  try {
    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    expect(harness.dependencies.createAcpRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ store: harness.stateRepository }),
    );
    expect(harness.dependencies.createProjectRepository).toHaveBeenCalledWith({
      projection: harness.stateRepository,
    });
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
    expect(harness.dependencies.createRuntimeProvider).not.toHaveBeenCalled();
  } finally {
    controller.abort();
  }
  await expect(run).resolves.toBe(0);
  expect(harness.close).toHaveBeenCalledOnce();
  expect(harness.databaseClose).toHaveBeenCalledOnce();
});
