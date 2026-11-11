import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EngineSelectionProvider } from "@codexly/ui/core/engine-selection-provider";
import { createAcpEngineSetupStorage, ACP_ENGINE_SETUP_KEY } from "@codexly/frontend-core/acp-engine-setup";
import { ENGINE_SETUP_KEY } from "@codexly/frontend-core/engine-setup";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import { GlobalSettingsPage as DesktopPage } from "../../src/features/settings/components/global-settings-page.js";
import { codexlyClient } from "../../../apps/web/src/features/projects/project-queries.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as desktopLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

for (const [platform, client] of [["web", codexlyClient], ["desktop", nativeClient]] as const) {
  it(`${platform}：额外引擎显式启用仅做 ACP 握手，失败保留原选择`, async () => {
    await Promise.all([webLanguage("zh-CN"), desktopLanguage("zh-CN")]);
    const marker = '{"engines":["codex"],"complete":true}';
    const data = new Map([[ENGINE_SETUP_KEY, marker]]);
    const storage = createAcpEngineSetupStorage({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
    });
    const query = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000 } } });
    let resolve!: (value: Awaited<ReturnType<typeof client.getAcpAgent>>) => void;
    const inspect = vi.spyOn(client, "getAcpAgent").mockRejectedValueOnce(new Error("offline")).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const settingsInspect = vi.fn((engine: "codex" | "claude") => inspect(engine));
    const oldSettings = vi.spyOn(client, "getClaudeSettings");
    const oldProfile = vi.spyOn(client, "getEngineProfile");
    const defaults = vi.spyOn(client, "getAcpDefaults");
    const props = {
      agentRuntime: "acp" as const, initialSection: "claude-provider" as const,
      apps: [], models: [], error: null, isPending: false,
      onClose: vi.fn(), onRetry: vi.fn(), onSave: vi.fn(),
    };
    const screen = await render(<QueryClientProvider client={query}><EngineSelectionProvider engines={["codex"]} storage={storage}>
      {platform === "web" ? <WebPage {...props} client={{ getAcpAgent: settingsInspect, authenticateAcpAgent: async () => ({}) } as unknown as SettingsClient} /> : <DesktopPage {...props} />}
    </EngineSelectionProvider></QueryClientProvider>);
    try {
      const enable = screen.getByRole("button", { name: "启用 Claude", exact: true });
      await expect.element(enable).toBeEnabled();
      expect(inspect).not.toHaveBeenCalled();
      await expect.element(screen.getByText("智能体未公布可用的认证方式。", { exact: true })).not.toBeInTheDocument();
      await enable.click();
      await expect.element(screen.getByRole("alert")).toHaveTextContent("准备失败");
      expect(data.has(ACP_ENGINE_SETUP_KEY)).toBe(false);
      await screen.getByRole("button", { name: "重试", exact: true }).click();
      await expect.element(screen.getByRole("button", { name: "正在准备…", exact: true })).toBeDisabled();
      await screen.getByRole("group", { name: "Claude", exact: true }).getByRole("button", { name: "智能体配置", exact: true }).click();
      await expect.element(screen.getByRole("button", { name: "正在准备…", exact: true })).toBeDisabled();
      await screen.getByRole("group", { name: "Claude", exact: true }).getByRole("button", { name: "模型服务", exact: true }).click();
      resolve({ engine: "claude", protocolVersion: 1, authMethods: [] });
      await expect.element(screen.getByText("智能体未公布可用的认证方式。", { exact: true })).toBeVisible();
      expect(inspect).toHaveBeenCalledTimes(2);
      expect(inspect.mock.calls.every((call) => call[0] === "claude")).toBe(true);
      expect(settingsInspect).toHaveBeenCalledTimes(platform === "web" ? 2 : 0);
      expect(oldSettings).not.toHaveBeenCalled();
      expect(oldProfile).not.toHaveBeenCalled();
      expect(defaults).not.toHaveBeenCalled();
      expect(data.get(ENGINE_SETUP_KEY)).toBe(marker);
      expect(JSON.parse(data.get(ACP_ENGINE_SETUP_KEY) ?? "null")).toEqual({ engines: ["codex", "claude"], complete: true });
      expect(props.onSave).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      query.clear();
      inspect.mockRestore(); oldSettings.mockRestore(); oldProfile.mockRestore(); defaults.mockRestore();
    }
  });
}
