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
import "../../src/shared/styles/globals.css";
const PRIVATE_KEY = "codexly:acp-engine-setup:v1";
const oldMarker = JSON.stringify({ engines: ["codex"], complete: false });
function Workspace() {
  return <main>已进入工作区：{useSelectedEngines()?.join(",")}</main>;
}
for (const [platform, Gate, client] of [
  ["web", WebGate, codexlyClient], ["desktop", NativeGate, nativeClient],
] as const) {
  it(`${platform}：选中后才握手，检查成功才完成，旧选择保持原字节`, async () => {
    await Promise.all([webLanguage("zh-CN"), nativeLanguage("zh-CN")]);
    localStorage.setItem(ENGINE_SETUP_KEY, oldMarker);
    localStorage.removeItem(PRIVATE_KEY);
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const capabilities = vi.spyOn(client, "getCapabilities").mockResolvedValue({
      runtime: "acp", provider: "codex", feedback: { upload: false },
      goals: { clear: false, read: false, update: false }, skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: true },
      turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
    });
    const inspect = vi.spyOn(client, "getAcpAgent").mockResolvedValue({
      engine: "codex", protocolVersion: 1, authMethods: [{ id: "native-login", name: "原生登录" }],
    });
    const check = vi.spyOn(client, "getAcpDefaults")
      .mockRejectedValueOnce(new Error("auth_required"))
      .mockResolvedValue({ configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] });
    const old = vi.spyOn(client, "getEngineProfile").mockRejectedValue(new Error("不得使用旧接口"));
    const view = () => <QueryClientProvider client={query}><Gate><Workspace /></Gate></QueryClientProvider>;
    const screen = await render(view());
    try {
      await expect.element(screen.getByRole("heading", { name: "选择编程助手", exact: true })).toBeVisible();
      expect(inspect).not.toHaveBeenCalled();
      await screen.getByRole("button", { name: "Codex OpenAI", exact: true }).click();
      await screen.getByRole("button", { name: "继续", exact: true }).click();
      await expect.element(screen.getByRole("button", { name: "原生登录", exact: true })).toBeEnabled();
      expect(check).not.toHaveBeenCalled();
      await screen.getByRole("button", { name: "连接并开始使用", exact: true }).click();
      await expect.element(screen.getByRole("alert")).toHaveTextContent("未连接");
      expect(JSON.parse(localStorage.getItem(PRIVATE_KEY) ?? "null")).toEqual({ engines: ["codex"], complete: false });
      await screen.getByRole("button", { name: "连接并开始使用", exact: true }).click();
      await expect.element(screen.getByText("已进入工作区：codex", { exact: true })).toBeVisible();
      expect(old).not.toHaveBeenCalled();
      expect(localStorage.getItem(ENGINE_SETUP_KEY)).toBe(oldMarker);
      expect(JSON.parse(localStorage.getItem(PRIVATE_KEY) ?? "null")).toEqual({ engines: ["codex"], complete: true });
      await screen.unmount();
      inspect.mockClear();
      check.mockClear();
      const reopened = await render(view());
      await expect.element(reopened.getByText("已进入工作区：codex", { exact: true })).toBeVisible();
      expect(inspect).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      await reopened.unmount();
    } finally {
      await screen.unmount();
      capabilities.mockRestore(); inspect.mockRestore(); check.mockRestore(); old.mockRestore();
      query.clear();
      localStorage.removeItem(ENGINE_SETUP_KEY); localStorage.removeItem(PRIVATE_KEY);
    }
  });
}
