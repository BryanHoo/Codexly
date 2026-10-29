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
  test(`重命名弹窗使用独立方形关闭按钮，窗口宽度 ${width}`, async () => {
    await page.viewport(width, 800);
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <TaskRenameDialog initialTitle="提交所有更改到远程仓库" isPending={false} onClose={vi.fn()} onRename={vi.fn()} />,
    );
    await expect.element(screen.getByRole("textbox", { name: "任务名称" })).toHaveFocus();
    const title = screen.getByRole("heading", { name: "重命名任务" });
    const close = screen.getByRole("button", { name: "关闭", exact: true });
    await expect.poll(() => getComputedStyle(screen.getByRole("dialog").element()).opacity).toBe("1");

    const buttonBox = close.element().getBoundingClientRect();
    expect(buttonBox.width).toBe(32);
    expect(buttonBox.height).toBe(32);
    const dialogBox = screen.getByRole("dialog").element().getBoundingClientRect();
    expect(dialogBox.right - buttonBox.right).toBeCloseTo(16 + screen.getByRole("dialog").element().clientLeft, 0);
    expect(buttonBox.top - dialogBox.top).toBeCloseTo(16 + screen.getByRole("dialog").element().clientLeft, 0);
    expect(parseFloat(getComputedStyle(title.element()).paddingInlineEnd)).toBeGreaterThanOrEqual(40);
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
    expect(buttonBox.width).toBe(32);
    expect(buttonBox.height).toBe(32);
    expect(close.element().querySelector("svg")!.getBoundingClientRect().width).toBe(16);
    const adjacentLines = [...textRange.getClientRects()].filter((line) => line.top < buttonBox.bottom && line.bottom > buttonBox.top);
    for (const line of adjacentLines) expect(line.right).toBeLessThanOrEqual(buttonBox.left);
    await close.click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  test(`归档标题不再拉伸或压窄关闭按钮，窗口宽度 ${width}`, async () => {
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
    const closeBox = close.element().getBoundingClientRect();
    expect(closeBox.width).toBe(32);
    expect(closeBox.height).toBe(32);
    const icon = close.element().querySelector("svg")!.getBoundingClientRect();
    expect(icon.width).toBe(16);
    expect(icon.height).toBe(16);
    expect(icon.top + icon.height / 2).toBeCloseTo(closeBox.top + closeBox.height / 2, 1);
    expect(document.querySelector('[data-slot="dialog-title-row"]')).toBeNull();
  });
}

test("提交保护覆盖 Escape 和遮罩；嵌套只关闭顶层且恢复各自焦点", async () => {
  function Harness() {
    const [pending, setPending] = useState(true);
    return <Dialog>
      <DialogTrigger render={<Button />}>打开父弹窗</DialogTrigger>
      <DialogContent closeLabel="关闭父弹窗" closeDisabled={pending} aria-describedby={undefined}>
        <DialogTitle>父弹窗</DialogTitle>
        <Button onClick={() => setPending(false)}>解除提交保护</Button>
        <Dialog>
          <DialogTrigger render={<Button />}>打开子弹窗</DialogTrigger>
          <DialogContent closeLabel="关闭子弹窗" aria-describedby={undefined}>
            <DialogTitle>子弹窗</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>;
  }
  const screen = await render(<Harness />);
  const trigger = screen.getByRole("button", { name: "打开父弹窗" });
  await trigger.click();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog", { name: "父弹窗" })).toBeVisible();
  await userEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!, { position: { x: 4, y: 4 } });
  await expect.element(screen.getByRole("dialog", { name: "父弹窗" })).toBeVisible();
  await screen.getByRole("button", { name: "解除提交保护" }).click();
  const childTrigger = screen.getByRole("button", { name: "打开子弹窗" });
  await childTrigger.click();
  await expect.element(screen.getByRole("dialog", { name: "子弹窗" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog", { name: "子弹窗" })).not.toBeInTheDocument();
  await expect.element(childTrigger).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});
