import type { AcpAgentCatalogPage } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ENGINE_SETUP_KEY } from "@codexly/frontend-core/engine-setup";
import { codexlyClient } from "../../../apps/web/src/features/projects/project-queries.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { EngineSetupGate as WebGate } from "../../../apps/web/src/features/provider-connection/components/engine-setup-gate.js";
import { EngineSetupGate as NativeGate } from "../../src/features/runtime/components/engine-setup-gate.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { toast } from "@codexly/ui/core/notifications";
import "../../src/shared/styles/globals.css";
const PRIVATE_KEY = "codexly:acp-engine-setup:v1";
const oldMarker = JSON.stringify({ engines: ["codex"], complete: false });
function Workspace() {
  return <main>已进入工作区：{useSelectedEngines()?.join(",")}</main>;
}
for (const [platform, Gate, client] of [
  ["web", WebGate, codexlyClient],
  ["desktop", NativeGate, nativeClient],
] as const) {
  it(`${platform}：后台检测不阻塞工作区，目录完成后自动更新选择并保留旧记录`, async () => {
    await Promise.all([webLanguage("zh-CN"), nativeLanguage("zh-CN")]);
    localStorage.setItem(ENGINE_SETUP_KEY, oldMarker);
    localStorage.removeItem(PRIVATE_KEY);
    let query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ready = vi.spyOn(toast, "success");
    const loading = vi.spyOn(toast, "add");
    const failed = vi.spyOn(toast, "error");
    const pending = Promise.withResolvers<AcpAgentCatalogPage>();
    const capabilities = vi.spyOn(client, "getCapabilities").mockResolvedValue({
      provider: "codex",
      feedback: { upload: false },
      goals: { clear: false, read: false, update: false },
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: true },
      turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
    });
    const catalog = vi
      .spyOn(client, "getAcpAgentCatalog")
      .mockImplementation(() => pending.promise);
    const inspect = vi.spyOn(client, "getAcpAgent");
    const check = vi.spyOn(client, "getAcpDefaults");
    const old = vi.spyOn(client, "getEngineProfile");
    let screen = await render(
      <QueryClientProvider client={query}>
        <Gate>
          <Workspace />
        </Gate>
      </QueryClientProvider>,
    );
    try {
      await expect.element(screen.getByText("已进入工作区：", { exact: true })).toBeVisible();
      expect(inspect).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      pending.resolve({
        agents: [
          {
            engine: "acp-gemini",
            name: "Gemini",
            description: "",
            installed: true,
            enabled: true,
            detected: true,
            environmentKeys: [],
          },
        ],
      });
      await expect
        .element(screen.getByText("已进入工作区：acp-gemini", { exact: true }))
        .toBeVisible();
      expect(catalog).toHaveBeenCalledOnce();
      expect(old).not.toHaveBeenCalled();
      expect(localStorage.getItem(ENGINE_SETUP_KEY)).toBe(oldMarker);
      expect(ready).toHaveBeenCalledOnce();
      const loadingCount = loading.mock.calls.length;
      await screen.unmount();
      query.clear();
      // 新建查询缓存并重挂载整个入口，模拟刷新后的启动；只保留浏览器持久记录。
      const reloaded = Promise.withResolvers<AcpAgentCatalogPage>();
      catalog.mockImplementation(() => reloaded.promise);
      query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      screen = await render(
        <QueryClientProvider client={query}>
          <Gate>
            <Workspace />
          </Gate>
        </QueryClientProvider>,
      );
      await expect.poll(() => catalog.mock.calls.length).toBe(2);
      expect(loading).toHaveBeenCalledTimes(loadingCount);
      reloaded.resolve(await pending.promise);
      await expect
        .element(screen.getByText("已进入工作区：acp-gemini", { exact: true }))
        .toBeVisible();
      expect(ready).toHaveBeenCalledOnce();
      expect(JSON.parse(localStorage.getItem(PRIVATE_KEY) ?? "null")).toEqual({
        engines: ["acp-gemini"],
        complete: true,
      });
      expect(localStorage.getItem(ENGINE_SETUP_KEY)).toBe(oldMarker);
      await screen.unmount();
      query.clear();
      // 已完成初始化仍需显示后续检测故障，不能因静默启动而吞掉错误。
      catalog.mockRejectedValue(new Error("检测离线"));
      query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      screen = await render(
        <QueryClientProvider client={query}>
          <Gate>
            <Workspace />
          </Gate>
        </QueryClientProvider>,
      );
      await expect.poll(() => failed.mock.calls.length).toBe(1);
      expect(ready).toHaveBeenCalledOnce();
    } finally {
      await screen.unmount();
      query.clear();
      capabilities.mockRestore();
      catalog.mockRestore();
      inspect.mockRestore();
      check.mockRestore();
      old.mockRestore();
      ready.mockRestore();
      loading.mockRestore();
      failed.mockRestore();
      toast.dismiss();
      localStorage.removeItem(ENGINE_SETUP_KEY);
      localStorage.removeItem(PRIVATE_KEY);
    }
  });
}
