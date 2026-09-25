import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";
import { ProjectSidebarHeader } from "./project-sidebar-header.js";
import { WorkbenchShortcuts } from "./workbench-shortcuts.js";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <WorkbenchShortcuts onSearchTasks={() => setOpen(true)} />
      <ProjectSidebarHeader onClose={vi.fn()} onSearch={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>聚合搜索</DialogTitle>
          <input aria-label="搜索内容" />
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("ProjectSidebarHeader", () => {
  it("opens a search dialog by click and primary+F without replacing the brand", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </I18nextProvider>,
    );
    const trigger = screen.getByRole("button", { name: /搜索/ });
    await trigger.click();
    await expect
      .element(screen.getByRole("dialog", { name: "聚合搜索" }))
      .toBeVisible();
    expect(document.querySelector('img[alt="Codexly"]')).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("dialog", { name: "聚合搜索" }))
      .not.toBeInTheDocument();
    const event = new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
      ...(/mac/i.test(navigator.platform)
        ? { metaKey: true }
        : { ctrlKey: true }),
    });
    document.dispatchEvent(event);
    await expect
      .element(screen.getByRole("dialog", { name: "聚合搜索" }))
      .toBeVisible();
    expect(event.defaultPrevented).toBe(true);
  });
});
