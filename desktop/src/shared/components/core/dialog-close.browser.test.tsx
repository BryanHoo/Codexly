import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Button } from "./button.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./dialog.js";
import { TaskRenameDialog } from "../../../features/workbench/components/task-rename-dialog.js";
import { i18n } from "../../../i18n/i18n.js";
import "../../styles/globals.css";

afterEach(async () => {
  await page.viewport(1440, 900);
});

for (const width of [375, 960]) {
  test(`重命名弹窗标题与紧凑关闭按钮垂直居中，窗口宽度 ${width}`, async () => {
    await page.viewport(width, 800);
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <TaskRenameDialog initialTitle="提交所有更改到远程仓库" isPending={false} onClose={vi.fn()} onRename={vi.fn()} />,
    );
    await expect.element(screen.getByRole("textbox", { name: "任务名称" })).toHaveFocus();
    const title = screen.getByRole("heading", { name: "重命名任务" });
    const close = screen.getByRole("button", { name: "关闭", exact: true });
    await expect.poll(() => getComputedStyle(screen.getByRole("dialog").element()).opacity).toBe("1");
    const headingBox = title.element().getBoundingClientRect();
    const buttonBox = close.element().getBoundingClientRect();
    expect(buttonBox.width).toBeLessThanOrEqual(24);
    expect(buttonBox.height).toBeCloseTo(headingBox.height, 1);
    expect(buttonBox.top).toBeCloseTo(headingBox.top, 1);
    expect(buttonBox.bottom).toBeCloseTo(headingBox.bottom, 1);
    expect(Math.abs(headingBox.top + headingBox.height / 2 - buttonBox.top - buttonBox.height / 2)).toBeLessThanOrEqual(0.5);
  });

  test(`关闭按钮避让长标题并遵守提交保护，窗口宽度 ${width}`, async () => {
    await page.viewport(width, 800);
    function Harness() {
      const [open, setOpen] = useState(false);
      const [pending, setPending] = useState(true);
      return (
        <Dialog open={open} onOpenChange={(next) => { if (next || !pending) setOpen(next); }}>
          <DialogTrigger asChild><Button>打开测试弹窗</Button></DialogTrigger>
          <DialogContent closeLabel="关闭" closeDisabled={pending} aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>很长的弹窗标题需要在窄窗口内换行显示，同时不能与右上角关闭按钮重叠</DialogTitle>
            </DialogHeader>
            <Button onClick={() => setPending(false)}>完成操作</Button>
          </DialogContent>
        </Dialog>
      );
    }
    const screen = await render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开测试弹窗" });
    await trigger.click();
    const close = screen.getByRole("button", { name: "关闭", exact: true });
    await expect.element(close).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    await screen.getByRole("button", { name: "完成操作" }).click();
    await expect.element(close).toBeEnabled();
    await expect.poll(() => getComputedStyle(screen.getByRole("dialog").element()).opacity).toBe("1");
    // 使用真实文本行盒核对标题避让，避免仅检查容器尺寸而漏掉文字与按钮重叠。
    const title = screen.getByRole("heading").element();
    const textRange = document.createRange();
    textRange.selectNodeContents(title);
    const buttonBox = close.element().getBoundingClientRect();
    expect(buttonBox.width).toBeLessThanOrEqual(24);
    expect(close.element().querySelector("svg")!.getBoundingClientRect().width).toBe(14);
    const titleBox = title.getBoundingClientRect();
    expect(buttonBox.height).toBeCloseTo(titleBox.height, 1);
    expect(buttonBox.top).toBeCloseTo(titleBox.top, 1);
    expect(buttonBox.bottom).toBeCloseTo(titleBox.bottom, 1);
    expect(Math.abs(titleBox.top + titleBox.height / 2 - buttonBox.top - buttonBox.height / 2)).toBeLessThanOrEqual(0.5);
    for (const line of textRange.getClientRects()) {
      expect(line.right).toBeLessThanOrEqual(buttonBox.left);
    }
    await close.click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  test(`归档标题文字行与悬停关闭容器等高，窗口宽度 ${width}`, async () => {
    await page.viewport(width, 400);
    const screen = await render(
      <Dialog open>
        <DialogContent closeLabel="关闭" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>ld-framework 的已归档任务</DialogTitle></DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "关闭", exact: true });
    await close.hover();
    await expect.poll(() => getComputedStyle(screen.getByRole("dialog").element()).opacity).toBe("1");
    await page.screenshot({ path: `../../../../test-results/dialog-hover-title-${width}.png` });
    const titleBox = screen.getByRole("heading").element().getBoundingClientRect();
    const closeBox = close.element().getBoundingClientRect();
    const titleSize = parseFloat(getComputedStyle(screen.getByRole("heading").element()).fontSize);
    expect(titleBox.height).toBeCloseTo(titleSize, 1);
    expect(closeBox.height).toBeCloseTo(titleBox.height, 1);
    expect(closeBox.top).toBeCloseTo(titleBox.top, 1);
    expect(closeBox.bottom).toBeCloseTo(titleBox.bottom, 1);
    const icon = close.element().querySelector("svg")!.getBoundingClientRect();
    expect(icon.height).toBe(14);
    expect(icon.top + icon.height / 2).toBeCloseTo(closeBox.top + closeBox.height / 2, 1);
  });
}
