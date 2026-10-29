import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useState } from "react";
import * as DesktopDrawer from "./drawer.js";
import * as WebDrawer from "../../../../../apps/web/src/shared/components/core/drawer.js";
import { Button } from "./button.js";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.js";
import "../../styles/globals.css";

afterEach(async () => { await page.viewport(1440, 900); });

for (const [platform, components] of [["Web", WebDrawer], ["桌面", DesktopDrawer]] as const) {
  const { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger, DrawerFooter } = components;
  for (const direction of ["left", "right"] as const) {
    for (const width of [375, 960]) {
      test(`${platform} ${direction} 抽屉 ${width}px：正文滚动、焦点圈定、关闭恢复`, async () => {
        await page.viewport(width, 700);
        const screen = await render(<>
          <Button>背景操作</Button>
          <Drawer swipeDirection={direction}>
            <DrawerTrigger render={<Button />}>打开抽屉</DrawerTrigger>
            <DrawerContent closeLabel="关闭抽屉" aria-describedby={undefined}>
              <DrawerHeader><DrawerTitle>任务抽屉</DrawerTitle></DrawerHeader>
              <div data-testid="drawer-scroll" className="min-h-0 flex-1 overflow-y-auto">
                {Array.from({ length: 80 }, (_, i) => <p key={i} className="h-8">任务 {i + 1}</p>)}
              </div>
              <DrawerFooter><Button>固定底部操作</Button></DrawerFooter>
            </DrawerContent>
          </Drawer>
        </>);
        const trigger = screen.getByRole("button", { name: "打开抽屉" });
        await trigger.click();
        const dialog = screen.getByRole("dialog", { name: "任务抽屉" });
        await expect.element(dialog).toHaveAttribute("data-swipe-direction", direction);
        await expect.poll(() => Math.abs(dialog.element().getBoundingClientRect()[direction] - (direction === "left" ? 0 : width))).toBeLessThan(1);
        const scroll = screen.getByTestId("drawer-scroll").element();
        expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
        scroll.scrollTop = 800;
        expect(scroll.scrollTop).toBe(800);
        for (let i = 0; i < 5; i++) {
          await userEvent.tab();
          await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true);
        }
        await screen.getByRole("button", { name: "关闭抽屉" }).click();
        await expect.element(dialog).not.toBeInTheDocument();
        await expect.element(trigger).toHaveFocus();
        expect(document.querySelector('[data-slot="drawer-viewport"]')).toBeNull();
        // 再次打开复用已加载模块，关闭后仍卸载实际浮层并恢复入口焦点。
        await trigger.click();
        await expect.element(dialog).toBeVisible();
        await userEvent.keyboard("{Escape}");
        await expect.element(dialog).not.toBeInTheDocument();
        await expect.element(trigger).toHaveFocus();
      });
    }
  }
}

test("Drawer 中的 Dialog 只关闭顶层，提交锁可取消抽屉关闭", async () => {
  const { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } = DesktopDrawer;
  const changed = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(true);
    return <Drawer open={open} onOpenChange={(next, details) => {
      if (!next && pending) { details.cancel(); return; }
      changed(next); setOpen(next);
    }}>
      <DrawerTrigger render={<Button />}>打开详情</DrawerTrigger>
      <DrawerContent closeLabel="关闭详情" aria-describedby={undefined}>
        <DrawerHeader><DrawerTitle>插件详情</DrawerTitle></DrawerHeader>
        <Button onClick={() => setPending(false)}>完成提交</Button>
        <Dialog>
          <DialogTrigger render={<Button />}>打开确认</DialogTrigger>
          <DialogContent closeLabel="关闭确认" aria-describedby={undefined}><DialogTitle>确认操作</DialogTitle></DialogContent>
        </Dialog>
      </DrawerContent>
    </Drawer>;
  }
  const screen = await render(<Harness />);
  const trigger = screen.getByRole("button", { name: "打开详情" });
  await trigger.click();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog", { name: "插件详情" })).toBeVisible();
  await screen.getByRole("button", { name: "关闭详情" }).click();
  expect(changed).not.toHaveBeenCalledWith(false);
  await screen.getByRole("button", { name: "完成提交" }).click();
  const child = screen.getByRole("button", { name: "打开确认" });
  await child.click();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog", { name: "确认操作" })).not.toBeInTheDocument();
  await expect.element(child).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

test("Drawer 的实际拖动通过原生 swipe 关闭并恢复入口焦点", async () => {
  const { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } = DesktopDrawer;
  const changed = vi.fn();
  await page.viewport(960, 700);
  const screen = await render(<Drawer showSwipeHandle onOpenChange={(open, details) => changed(open, details.reason)}>
    <DrawerTrigger render={<Button />}>打开可滑动抽屉</DrawerTrigger>
    <DrawerContent closeLabel="关闭滑动抽屉" aria-describedby={undefined}>
      <DrawerHeader data-testid="swipe-header"><DrawerTitle>滑动详情</DrawerTitle></DrawerHeader>
      <p>可滚动正文之外从标题区域拖动关闭。</p>
    </DrawerContent>
  </Drawer>);
  const trigger = screen.getByRole("button", { name: "打开可滑动抽屉" });
  await trigger.click();
  const handle = document.querySelector('[data-slot="drawer-swipe-handle"]')!;
  const header = screen.getByTestId("swipe-header");
  await userEvent.dragAndDrop(handle, header, { steps: 20, sourcePosition: { x: 6, y: 8 }, targetPosition: { x: 490, y: 8 } });
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledWith(false, "swipe");
  await expect.element(trigger).toHaveFocus();
});
