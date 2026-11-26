import { expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

it("生产启动只装配 ACP 工厂并传入启动环境快照，关闭顺序为 HTTP、ACP、数据库", async () => {
  vi.stubEnv("ACP_TEST_CONFIG", "/isolated/agent");
  const harness = createHarness();
  const createAcpRuntime = vi.fn(() => ({ ...harness.runtimeProvider, close: harness.close }));
  const controller = new AbortController();
  const run = runCli(["start", "--no-open"], {
    ...harness.options,
    dependencies: { ...harness.dependencies, createAcpRuntime },
    signal: controller.signal,
  });
  try {
    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(createAcpRuntime).toHaveBeenCalledOnce();
    expect(createAcpRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        store: harness.stateRepository,
        environment: expect.objectContaining({
          ACP_TEST_CONFIG: "/isolated/agent",
        }) as unknown,
      }),
    );
  } finally {
    controller.abort();
    await run;
    vi.unstubAllEnvs();
  }
  expect(harness.lifecycle.slice(-3)).toEqual(["server.close", "runtime.close", "database.close"]);
});
