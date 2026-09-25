import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog.js";
import { WorkbenchShortcuts } from "./workbench-shortcuts.js";
import "../../../shared/styles/globals.css";

function shortcutEvent(key: string, extra: KeyboardEventInit = {}) {
  const mac = /mac/i.test(navigator.platform);
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: !mac,
    key,
    metaKey: mac,
    ...extra,
  });
}

describe("WorkbenchShortcuts", () => {
  it("runs common actions once and ignores shortcuts while a modal is open", async () => {
    const onNewTask = vi.fn();
    const onToggleSidebar = vi.fn();
    const screen = await render(
      <WorkbenchShortcuts
        onNewTask={onNewTask}
        onOpenSettings={vi.fn()}
        onSearchTasks={vi.fn()}
        onShowShortcuts={vi.fn()}
        onToggleInspector={vi.fn()}
        onToggleSidebar={onToggleSidebar}
      />,
    );

    document.dispatchEvent(shortcutEvent("n"));
    document.dispatchEvent(shortcutEvent("b", { repeat: true }));
    expect(onNewTask).toHaveBeenCalledOnce();
    expect(onToggleSidebar).not.toHaveBeenCalled();

    const modal = document.createElement("dialog");
    modal.open = true;
    document.body.append(modal);
    document.dispatchEvent(shortcutEvent("n"));
    expect(onNewTask).toHaveBeenCalledOnce();
    modal.remove();
    await screen.unmount();
  });
});

describe("KeyboardShortcutsDialog", () => {
  it("shows every shortcut using platform-native key labels", async () => {
    await i18n.changeLanguage("zh-CN");

    function Harness() {
      const [open, setOpen] = useState(true);
      return <KeyboardShortcutsDialog onOpenChange={setOpen} open={open} />;
    }

    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("dialog", { name: "键盘快捷键" })).toBeVisible();
    await expect.element(screen.getByText("新建任务")).toBeVisible();
    await expect.element(screen.getByText("显示或隐藏终端")).toBeVisible();
    expect(screen.getByRole("listitem").all()).toHaveLength(7);
    await page.viewport(900, 700);
    await page.screenshot({ path: "../../../../test-results/keyboard-shortcuts-dialog.png" });
    await page.viewport(1_440, 900);
  });
});
