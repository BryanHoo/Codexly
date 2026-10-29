import type { AppInfoResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";
import "../../../shared/styles/globals.css";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/Codexly/blob/main/CHANGELOG.md",
  codexVersion: "0.163.0",
  latestVersion: "0.2.0",
  releaseNotes: "Update notes",
  releaseNotesVersion: "0.2.0",
  repositoryUrl: "https://github.com/BryanHoo/Codexly",
  status: "available",
  updateAvailable: true,
} satisfies AppInfoResponse;

describe("SidebarSettingsButton", () => {
  it("opens release notes from the upgrade hint without navigating to About", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpen = vi.fn();
    const onOpenShortcuts = vi.fn();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <SidebarSettingsButton
            onUpdate={onUpdate}
            appInfo={appInfo}
            onOpen={onOpen}
            onOpenShortcuts={onOpenShortcuts}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    const aboutButton = screen.getByRole("button", { name: /Codexly v0\.1\.0/ });
    await expect.element(aboutButton).toHaveTextContent("v0.1.0");
    await screen.getByRole("button", { name: "升级", exact: true }).click();
    expect(onOpen).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("dialog", { name: "0.2.0 更新日志" })).toBeVisible();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "更新", exact: true }).click();
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith("0.2.0", expect.any(Function));
    await expect.element(screen.getByRole("status")).toHaveTextContent("更新完成");
    await screen.getByRole("button", { name: "关闭更新日志" }).click();

    await screen.getByRole("button", { name: "帮助", exact: true }).click();
    const shortcutsButton = screen.getByRole("button", { name: "键盘快捷键" });
    await shortcutsButton.click();
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
  });

  it("does not show the update hint when the app is current", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <SidebarSettingsButton
            onUpdate={vi.fn()}
            appInfo={{
              ...appInfo,
              latestVersion: null,
              status: "current",
              updateAvailable: false,
            }}
            onOpen={vi.fn()}
            onOpenShortcuts={vi.fn()}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await expect.element(screen.getByText("v0.1.0", { exact: true })).toBeVisible();
    expect(screen.getByText("升级").query()).toBeNull();
  });
});
