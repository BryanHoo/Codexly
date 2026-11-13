import { expect, it, vi } from "vitest";
import { runCli } from "./cli-command.js";
import { createHarness } from "./cli-command.test-support.js";

it("生产启动只装配 ACP 工厂并传入启动环境快照，关闭顺序为 HTTP、ACP、数据库", async () => {
  const harness = createHarness();
  const createAcpRuntime = vi.fn(() => ({ ...harness.runtimeProvider, close: harness.close }));
  const controller = new AbortController();
  const run = runCli(
    ["start", "--no-open", "--codex-home", "/isolated/codex", "--codex-bin", "/isolated/bin/codex"],
    {
      ...harness.options,
      dependencies: { ...harness.dependencies, createAcpRuntime },
      signal: controller.signal,
    },
  );
  try {
    await vi.waitFor(() => {
      expect(harness.serverListen).toHaveBeenCalledOnce();
    });
    expect(createAcpRuntime).toHaveBeenCalledOnce();
    expect(createAcpRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        store: harness.stateRepository,
        environment: expect.objectContaining({
          CODEX_HOME: "/isolated/codex",
          CODEX_PATH: "/isolated/bin/codex",
        }) as unknown,
      }),
    );
    expect(harness.dependencies.createRuntimeProvider).not.toHaveBeenCalled();
    expect(harness.dependencies.startCodexAppServer).not.toHaveBeenCalled();
  } finally {
    controller.abort();
    await run;
  }
  expect(harness.lifecycle.slice(-3)).toEqual(["server.close", "runtime.close", "database.close"]);
});
