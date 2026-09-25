import type { AppInfoResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/Codexly/blob/main/desktop/CHANGELOG.md",
  codexVersion: "0.156.0",
  latestVersion: "0.2.0",
  releaseNotes: "Update notes",
  releaseNotesVersion: "0.2.0",
  repositoryUrl: "https://github.com/BryanHoo/Codexly",
  status: "available",
  updateAvailable: true,
} satisfies AppInfoResponse;

describe("SidebarSettingsButton", () => {
  it("shows a compact upgrade hint next to the version and opens About", async () => {
    await i18n.changeLanguage("zh-CN");
    const onOpen = vi.fn();
    const onOpenShortcuts = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <SidebarSettingsButton
            appInfo={appInfo}
            onOpen={onOpen}
            onOpenShortcuts={onOpenShortcuts}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    const aboutButton = screen.getByRole("button", { name: /Codexly v0\.1\.0/ });
    await expect.element(aboutButton).toHaveTextContent("v0.1.0 升级");
    await aboutButton.click();
    expect(onOpen).toHaveBeenCalledWith("about");

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
