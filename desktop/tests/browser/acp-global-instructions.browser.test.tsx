import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { Toaster } from "@codexly/ui/core/toaster";
import type { ApplicationPreferences, SaveAgentInstructions } from "@codexly/protocol/application-preferences";
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

function useApplicationPreferences() {
  return useQuery({
    queryKey: ["application-preferences"],
    queryFn: async () => ({ settings: initial }),
    initialData: { settings: initial },
    staleTime: Infinity,
  }).data.settings;
}

for (const [platform, SettingsPage, width] of [
  ["Web", WebPage, 390],
  ["桌面", DesktopPage, 960],
] as const) {
  it(`${platform} 在智能体分组打开全局指令并保存与清除`, async () => {
    await page.viewport(width, 844);
    await Promise.all([webLanguage("zh-CN"), desktopLanguage("zh-CN")]);
    const getAcpAgentCatalog = vi.fn(async () => ({ agents: [] }));
    const catalog = vi
      .spyOn(nativeClient, "getAcpAgentCatalog")
      .mockImplementation(getAcpAgentCatalog);
    const targets = {
      version: "a".repeat(64),
      files: [{ agents: ["Codex"], path: "/fixture/codex/AGENTS.md", exists: true }],
      unsupported: [],
    };
    const getAgentInstructionsTargets = vi.fn(async () => targets).mockRejectedValueOnce(new Error("offline"));
    const saveAgentInstructions = vi.fn(async ({ content }: SaveAgentInstructions) => ({
      ...initial, globalInstructions: content,
    }));
    const nativeTargets = vi.spyOn(nativeClient, "getAgentInstructionsTargets").mockImplementation(getAgentInstructionsTargets);
    const nativeSave = vi.spyOn(nativeClient, "saveAgentInstructions").mockImplementation(saveAgentInstructions);
    const client = {
      getAgentInstructionsTargets,
      saveAgentInstructions,
      getAcpAgentCatalog,
      installAcpAgent: vi.fn(),
      configureAcpAgent: vi.fn(),
    } as unknown as SettingsClient;
    const onSave = vi.fn(async (_value: ApplicationPreferences) => undefined);
    function SettingsHarness() {
      const settings = useApplicationPreferences();
      return (
        <TooltipProvider>
          <Toaster />
          <div style={{ height: "100dvh" }}>
            <SettingsPage
              client={client}
              agentRuntime="acp"
              initialSection="acp"
              apps={[]}
              error={null}
              isPending={false}
              models={[]}
              settings={settings}
              onClose={() => undefined}
              onRetry={() => undefined}
              onSave={onSave}
            />
          </div>
        </TooltipProvider>
      );
    }
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsHarness />
      </QueryClientProvider>,
    );
    try {
      const agents = screen.getByRole("group", { name: "智能体", exact: true });
      const acp = agents.getByRole("button", { name: "ACP", exact: true });
      const instructions = agents.getByRole("button", { name: "全局指令", exact: true });
      await expect.element(acp).toHaveAttribute("aria-current", "page");
      await expect.element(instructions).toBeVisible();
      await expect
        .element(
          screen
            .getByRole("region", { name: "ACP", exact: true })
            .getByRole("button", { name: "全局指令", exact: true }),
        )
        .not.toBeInTheDocument();
      await screen.getByRole("searchbox").fill("全局指令");
      await expect.element(acp).not.toBeInTheDocument();
      await instructions.click();
      await expect.element(instructions).toHaveAttribute("aria-current", "page");
      const editor = screen.getByRole("textbox", { name: "全局指令", exact: true });
      await expect.element(editor).toHaveValue("");
      await editor.fill("使用中文");
      editor.element().blur();
      expect(saveAgentInstructions).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      const save = screen.getByRole("button", { name: "保存", exact: true });
      await screen.getByRole("button", { name: "取消", exact: true }).click();
      await expect.element(editor).toHaveValue("");
      expect(saveAgentInstructions).not.toHaveBeenCalled();
      await editor.fill("使用中文");
      const saveElement = save.element();
      const actionBar = saveElement.parentElement;
      expect(actionBar).not.toBeNull();
      expect(Math.abs(saveElement.getBoundingClientRect().right - (actionBar?.getBoundingClientRect().right ?? 0))).toBeLessThan(2);
      const dialog = screen.getByRole("dialog", { name: "确认保存全局指令" });
      await save.click();
      const retry = dialog.getByRole("button", { name: "重试", exact: true });
      await expect.element(retry).toBeVisible();
      const cancel = dialog.getByRole("button", { name: "取消" });
      const confirm = dialog.getByRole("button", { name: "确认保存" });
      await expect.element(confirm).toBeDisabled();
      const rects = [cancel, retry, confirm].map((button) => button.element().getBoundingClientRect());
      const [cancelRect, retryRect, confirmRect] = rects;
      expect(cancelRect?.right).toBeLessThan(retryRect?.left ?? 0);
      expect(retryRect?.right).toBeLessThan(confirmRect?.left ?? 0);
      expect(Math.abs((cancelRect?.top ?? 0) - (confirmRect?.top ?? 0))).toBeLessThan(2);
      const footer = confirm.element().parentElement;
      expect(Math.abs((confirmRect?.right ?? 0) - (footer?.getBoundingClientRect().right ?? 0))).toBeLessThan(2);
      await retry.click();
      await expect.element(dialog.getByText("/fixture/codex/AGENTS.md", { exact: true })).toBeVisible();
      await expect.element(dialog.getByText("Codex · 覆盖")).toBeVisible();
      await dialog.getByRole("button", { name: "取消" }).click();
      expect(saveAgentInstructions).not.toHaveBeenCalled();
      await save.click();
      await dialog.getByRole("button", { name: "确认保存" }).click();
      await expect.poll(() => saveAgentInstructions.mock.calls[0]?.[0]).toEqual({
        content: "使用中文", version: targets.version,
      });
      await expect
        .element(page.elementLocator(document.body).getByText("全局指令已保存", { exact: true }))
        .toBeVisible();
      expect(document.querySelector('[data-slot="toast-title"]')?.textContent).toBe("全局指令已保存");
      await expect.element(dialog).not.toBeInTheDocument();
      expect(document.querySelector("#settings-panel-global-instructions [role=status]")).toBeNull();
      await expect.element(editor).toHaveValue("使用中文");
      await editor.fill("");
      await save.click();
      await confirm.click();
      await expect.poll(() => saveAgentInstructions.mock.calls[1]?.[0]).toEqual({
        content: "", version: targets.version,
      });
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(editor).toHaveValue("");
    } finally {
      await screen.unmount();
      catalog.mockRestore();
      nativeTargets.mockRestore();
      nativeSave.mockRestore();
    }
  });
}
