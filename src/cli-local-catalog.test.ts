import { expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

it("closes the owned RPC transport after serving through the local catalog adapter", async () => {
  const harness = createHarness();
  Object.assign(harness.stateRepository, {
    catalog: (operation: string) => Promise.resolve(operation === "migration.done" ? true : []),
  });
  const original = await harness.dependencies.startCodexAppServer();
  const transport = Object.assign(harness.client, { close: vi.fn() });
  // 真实 App Server 在退出时关闭自己持有的 JSONL 连接；领域适配器没有 close 方法。
  const runtime = {
    ...original,
    client: transport,
    close() {
      this.client.close();
      return original.close();
    },
  };
  harness.dependencies.startCodexAppServer = vi.fn(() => Promise.resolve(runtime));
  const controller = new AbortController();
  const run = runCli(["start", "--no-open"], {
    ...harness.options,
    signal: controller.signal,
  });
  try {
    await vi.waitFor(() => {
      expect(harness.dependencies.createServer).toHaveBeenCalledOnce();
    });
    const [options] = vi.mocked(harness.dependencies.createRuntimeProvider).mock.calls[0] ?? [];
    expect(typeof options?.client.readLocalTask).toBe("function");
  } finally {
    controller.abort();
  }
  await expect(run).resolves.toBe(0);
  expect(transport.close).toHaveBeenCalledOnce();
  expect(harness.stderr).toEqual([]);
});
