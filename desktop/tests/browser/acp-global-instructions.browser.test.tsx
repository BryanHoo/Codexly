import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import type { ApplicationPreferences } from "@codexly/protocol/application-preferences";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import { GlobalSettingsPage as DesktopPage } from "../../src/features/settings/components/global-settings-page.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as desktopLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

const initial: ApplicationPreferences = {
  defaultAgent: "codex",
  defaultModel: null,
  commitMessagePrompt: "",
  taskTitlePrompt: "",
  promptOptimizationPrompt: "",
  defaultOpenAppId: null,
  followUpBehavior: "queue",
  pet: { enabled: false, selectedPetId: null },
};

for (const [platform, SettingsPage, width] of [
  ["Web", WebPage, 390],
  ["桌面", DesktopPage, 960],
] as const) {
  it(`${platform} 无已安装 Agent 时仍可保存并清除全局指令`, async () => {
    await page.viewport(width, 844);
    await Promise.all([webLanguage("zh-CN"), desktopLanguage("zh-CN")]);
    const getAcpAgentCatalog = vi.fn(async () => ({ agents: [] }));
    const catalog = vi
      .spyOn(nativeClient, "getAcpAgentCatalog")
      .mockImplementation(getAcpAgentCatalog);
    const client = {
      getAcpAgentCatalog,
      installAcpAgent: vi.fn(),
      configureAcpAgent: vi.fn(),
    } as unknown as SettingsClient;
    const onSave = vi.fn(async (_value: ApplicationPreferences) => undefined);
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <div style={{ height: "100dvh" }}>
            <SettingsPage
              client={client}
              agentRuntime="acp"
              initialSection="acp"
              apps={[]}
              error={null}
              isPending={false}
              models={[]}
              settings={initial}
              onClose={() => undefined}
              onRetry={() => undefined}
              onSave={onSave}
            />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    try {
      await screen.getByRole("button", { name: "全局指令", exact: true }).click();
      const editor = screen.getByRole("textbox", { name: "全局指令", exact: true });
      await expect.element(editor).toHaveValue("");
      await editor.fill("使用中文");
      editor.element().blur();
      await expect
        .poll(() => onSave.mock.calls[0]?.[0])
        .toEqual({ ...initial, globalInstructions: "使用中文" });
      await editor.fill("");
      editor.element().blur();
      await expect
        .poll(() => onSave.mock.calls.at(-1)?.[0])
        .toEqual({ ...initial, globalInstructions: "" });
    } finally {
      await screen.unmount();
      catalog.mockRestore();
    }
  });
}
