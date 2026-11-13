import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcpSettingsPanel } from "@codexly/ui/core/acp-settings-panel";
import { SettingsPageFrame as WebFrame } from "../../../apps/web/src/features/settings/components/settings-page-frame.js";
import { SettingsPageFrame as NativeFrame } from "../../src/features/settings/components/settings-page-frame.js";
import {
  SettingsField,
  SettingsSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
import { changeAppLanguage } from "../../src/i18n/i18n.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";
for (const [platform, Frame] of [
  ["web", WebFrame],
  ["desktop", NativeFrame],
] as const) {
  for (const width of [390, 1280])
    it(`${platform} ${width}：独立滚动与固定关闭区`, async () => {
      await Promise.all([changeAppLanguage("zh-CN"), webLanguage("zh-CN")]);
      await page.viewport(width, 720);
      const client = {
        getAcpAgent: vi.fn(async () => ({
          engine: "codex" as const,
          protocolVersion: 1,
          authMethods: [],
        })),
        getAcpDefaults: vi.fn(async () => ({
          configOptions: Array.from({ length: 40 }, (_, id) => ({
            id: String(id),
            name: `选项 ${id}`,
            type: "boolean" as const,
            currentValue: false,
          })),
          defaults: {},
          unmappedLegacy: [],
          invalidDefaults: [],
        })),
        setAcpDefaultConfig: vi.fn(),
      };
      const screen = await render(
        <QueryClientProvider client={new QueryClient()}>
          <Frame activeSection="acp" onBack={vi.fn()} onSectionChange={vi.fn()}>
            <AcpSettingsPanel
              client={client}
              language="zh-CN"
              Field={SettingsField}
              Select={SettingsSelect}
            />
          </Frame>
        </QueryClientProvider>,
      );
      await expect
        .element(page.getByRole("switch", { name: "选项 39", exact: true }))
        .toBeInTheDocument();
      const dialog = page.getByRole("dialog", { name: "全局设置", exact: true }).element();
      const close = page.getByRole("button", { name: "关闭", exact: true }).element();
      const initial = close.getBoundingClientRect();
      const scroll = dialog.querySelector<HTMLElement>('[data-slot="settings-detail-scroll"]');
      expect(scroll).not.toBeNull();
      const agent = page.getByRole("navigation", { name: "选择 Agent" }).element();
      const agentTop = agent.getBoundingClientRect().top;
      scroll!.scrollTop = scroll!.scrollHeight;
      await expect.poll(() => scroll!.scrollTop).toBeGreaterThan(100);
      expect(close.getBoundingClientRect().top).toBe(initial.top);
      expect(agent.getBoundingClientRect().top).toBe(agentTop);
      expect(dialog.scrollTop).toBe(0);
      expect(dialog.querySelector("main")!.scrollTop).toBe(0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const toggle = page.getByRole("switch", { name: "启用 Codex", exact: true }).element();
      expect(toggle.getBoundingClientRect().height).toBe(20);
      expect(toggle.getBoundingClientRect().width).toBe(36);
      expect(
        getComputedStyle(page.getByRole("button", { name: "Codex", exact: true }).element())
          .backgroundColor,
      ).toBe("rgba(0, 0, 0, 0)");
      await screen.unmount();
    });
  it(`${platform}：卡片骨架保留留白和字段密度`, async () => {
    const client = {
      getAcpAgent: vi.fn(async () => ({
        engine: "codex" as const,
        protocolVersion: 1,
        authMethods: [],
      })),
      getAcpDefaults: vi.fn(() => new Promise<never>(() => {})),
      setAcpDefaultConfig: vi.fn(),
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Frame activeSection="acp" onBack={vi.fn()} onSectionChange={vi.fn()}>
          <AcpSettingsPanel
            client={client}
            language="zh-CN"
            Field={SettingsField}
            Select={SettingsSelect}
          />
        </Frame>
      </QueryClientProvider>,
    );
    const section = page
      .getByRole("heading", { name: "会话默认配置", exact: true })
      .element().parentElement!;
    const skeleton = section.querySelector<HTMLElement>('[data-slot="loading-skeleton"]')!;
    expect(skeleton.dataset.variant).toBe("settings-fields");
    expect(parseFloat(getComputedStyle(skeleton).paddingTop)).toBeGreaterThanOrEqual(4);
    expect(skeleton.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
    await screen.unmount();
  });
}
