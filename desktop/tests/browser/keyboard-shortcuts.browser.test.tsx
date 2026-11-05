import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { KeyboardShortcutsDialog } from "@codexly/ui/core/keyboard-shortcuts-dialog";
import { keyboardShortcutChinese, keyboardShortcutEnglish } from "@codexly/frontend-core/keyboard-shortcut-labels";
import { SplitWorkspaceShortcuts } from "@codexly/ui/core/split-workspace-actions";
import { splitPaneKey } from "@codexly/frontend-core/split-workspace";
import "../../src/shared/styles/globals.css";

afterEach(async () => {
  document.documentElement.classList.remove("dark");
  await page.viewport(1440, 900);
});

for (const platform of ["desktop", "web"] as const) {
  for (const width of [360, 1024]) {
    for (const labels of [keyboardShortcutChinese, keyboardShortcutEnglish]) {
      test(`${platform} ${width} ${labels.title}：宽度、滚动与关闭`, async () => {
        await page.viewport(width, 768);
        if (labels === keyboardShortcutEnglish) document.documentElement.classList.add("dark");
        function Harness() {
          const [open, setOpen] = useState(true);
          return <KeyboardShortcutsDialog open={open} onOpenChange={setOpen} labels={labels} platform={platform} />;
        }
        const screen = await render(<Harness />);
        await expect.element(screen.getByRole("dialog")).toBeVisible();
        const dialog = screen.getByRole("dialog").element();
        await expect.poll(() => getComputedStyle(dialog).opacity).toBe("1");
        const box = dialog.getBoundingClientRect();
        expect(box.width).toBeLessThanOrEqual(width - 30);
        expect(box.height).toBeLessThanOrEqual(674);
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        const scroll = dialog.querySelector<HTMLElement>("[data-shortcuts-scroll]")!;
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
        const sections = [...dialog.querySelectorAll("section")];
        const workspace = sections.find((section) => section.textContent?.includes(labels.sections.workspace))!;
        const generalBox = sections[0]!.getBoundingClientRect();
        const workspaceBox = workspace.getBoundingClientRect();
        // 所有宽度都执行同一组断言，参数只决定预期布局，避免分支跳过检查。
        expect({
          wideDialog: box.width > 780,
          sameRow: Math.abs(generalBox.top - workspaceBox.top) < 1,
          nextColumn: workspaceBox.left > generalBox.right,
          nextRow: workspaceBox.top > generalBox.bottom,
          scrolls: scroll.scrollHeight > scroll.clientHeight,
        }).toEqual(width > 720
          ? { wideDialog: true, sameRow: true, nextColumn: true, nextRow: false, scrolls: false }
          : { wideDialog: false, sameRow: false, nextColumn: false, nextRow: true, scrolls: true });
        // 两种布局都尝试滚到底部，关闭按钮始终留在标题区域。
        scroll.scrollTop = scroll.scrollHeight;
        expect(screen.getByRole("button", { name: labels.close, exact: true }).element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top);
        await screen.getByRole("button", { name: labels.close, exact: true }).click();
        await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
      });
    }
  }
}

test("一次按键分屏，旧方向组合及弹窗内不修改工作区", async () => {
  const pane = { projectId: "project", taskId: "task" };
  const split = vi.fn();
  const workspace = { enabled: true, panes: [pane], activeKey: splitPaneKey(pane), split };
  // 快捷键边界只读取上述字段，其他动作保持独立。
  await render(<SplitWorkspaceShortcuts workspace={workspace as Parameters<typeof SplitWorkspaceShortcuts>[0]["workspace"]} />);
  const mac = /mac/i.test(navigator.platform);
  const press = (overrides: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: ")", code: "Digit0", metaKey: mac, ctrlKey: !mac, shiftKey: true, bubbles: true, cancelable: true, ...overrides });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(press()).toBe(true);
  expect(split).toHaveBeenCalledWith(pane, "right");
  split.mockClear();
  expect(press({ code: "ArrowRight", key: "ArrowRight", altKey: true, metaKey: false, ctrlKey: false })).toBe(false);
  const screen = await render(<KeyboardShortcutsDialog open onOpenChange={vi.fn()} labels={keyboardShortcutChinese} />);
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  expect(press()).toBe(false);
  expect(split).not.toHaveBeenCalled();
});
