import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createEngineActivation } from "@codexly/frontend-core/engine-activation";
import { EngineActivationContext } from "@codexly/ui/core/engine-selection";
import { EngineSettingsGate } from "@codexly/ui/core/engine-settings-gate";

it.each([
  ["codex", "claude"],
  ["claude", "codex"],
] as const)("blocks %s settings when only %s is enabled", async (engine, existing) => {
  const activation = createEngineActivation([existing], vi.fn());
  const prepare = vi.fn(() => Promise.resolve());
  const mount = vi.fn();
  function Configuration() {
    mount();
    return <input aria-label="API Key" />;
  }
  const render = () =>
    renderToStaticMarkup(
      <EngineActivationContext value={activation}>
        <EngineSettingsGate engine={engine} language="zh-CN" download prepare={prepare}>
          <Configuration />
        </EngineSettingsGate>
      </EngineActivationContext>,
    );
  expect(render()).toContain(`启用并下载 ${engine === "codex" ? "Codex" : "Claude"}`);
  expect(mount).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  const deferred = Promise.withResolvers<undefined>();
  const result = activation.enable(engine, (report) => {
    report("下载 50%");
    return deferred.promise;
  });
  expect(render()).toContain("下载 50%");
  expect(mount).not.toHaveBeenCalled();
  deferred.resolve(undefined);
  await result;
  expect(render()).toContain('aria-label="API Key"');
  expect(mount).toHaveBeenCalledOnce();
});
it("keeps failed installation locked with a retry action and uses server wording on web", async () => {
  const activation = createEngineActivation(["claude"], vi.fn());
  await expect(
    activation.enable("codex", () => Promise.reject(new Error("offline"))),
  ).rejects.toThrow();
  const markup = renderToStaticMarkup(
    <EngineActivationContext value={activation}>
      <EngineSettingsGate
        engine="codex"
        language="zh-CN"
        download={false}
        prepare={() => Promise.resolve()}
      >
        <input aria-label="API Key" />
      </EngineSettingsGate>
    </EngineActivationContext>,
  );
  expect(markup).toContain("服务端运行环境");
  expect(markup).toContain("重试");
  expect(markup).not.toContain("API Key");
});
