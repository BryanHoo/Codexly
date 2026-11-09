import "../../../shared/styles/globals.css";
import { describe, expect, it, vi } from "vitest";
import { Activity, useState } from "react";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { SidebarFooter } from "@codexly/ui/core/sidebar-footer";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";

const labels = {
  settings: "设置", help: "帮助", version: "关于版本", update: "升级", guide: "使用文档", shortcuts: "键盘快捷键",

};

describe("独立底栏入口", () => {
  it("设置、帮助、版本、更新独立点击，底栏空白无操作", async () => {
    const onSettings = vi.fn(), onAbout = vi.fn(), onUpdate = vi.fn();
    const screen = await render(<TooltipProvider><SidebarFooter labels={labels} version="1.0.0" updateAvailable
      onSettings={onSettings} onAbout={onAbout} onUpdate={onUpdate} /></TooltipProvider>);
    await screen.getByTestId("sidebar-footer-spacer").click();
    expect(onSettings).not.toHaveBeenCalled();
    expect(onAbout).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "设置", exact: true }).click();
    expect(onSettings).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "关于版本", exact: true }).click();
    expect(onAbout).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "升级", exact: true }).click();
    expect(onUpdate).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "帮助", exact: true }).click();
    await expect.element(screen.getByRole("link", { name: "使用文档" })).toBeVisible();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.element(screen.getByRole("button", { name: "帮助", exact: true })).toHaveFocus();
  });
});


it.each([360, 1280])("%ipx 工作台进入设置时帮助随 Activity 隐藏，返回后仍可关闭", async (width) => {
  await page.viewport(width, 800);
  function Shell() {
    const [settings, setSettings] = useState(false);
    return <TooltipProvider>
      <button onClick={() => setSettings(value => !value)}>切换设置</button>
      <Activity mode={settings ? "hidden" : "visible"}>
        <SidebarFooter labels={labels} version="1.0.0"
          onSettings={() => setSettings(true)} onAbout={() => setSettings(true)} />
      </Activity>
    </TooltipProvider>;
  }
  const screen = await render(<Shell />);
  expect(screen.getByRole("button", { name: /通知/ }).query()).toBeNull();
  await screen.getByRole("button", { name: "帮助", exact: true }).click();
  // 模拟设置快捷键等不经过底栏外部点击的入口，确保隐藏本身能覆盖 Portal。
  await screen.getByRole("button", { name: "切换设置", exact: true }).click();
  await expect.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(node => node.getBoundingClientRect().height > 0)).toBe(false);
  await screen.getByRole("button", { name: "切换设置", exact: true }).click();
  // Activity 可能保留帮助菜单的打开状态；返回后先正常关闭，再验证其他入口。
  if (screen.getByRole("button", { name: "帮助", exact: true }).element().getAttribute("aria-expanded") === "true") {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  await expect.element(screen.getByRole("button", { name: "帮助", exact: true })).toHaveAttribute("aria-expanded", "false");
  await screen.getByRole("button", { name: "关于版本", exact: true }).click();
  await expect.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(node => node.getBoundingClientRect().height > 0)).toBe(false);
  await screen.getByRole("button", { name: "切换设置", exact: true }).click();
  await screen.getByRole("button", { name: "帮助", exact: true }).click();
  await expect.element(screen.getByRole("link", { name: "使用文档" })).toBeVisible();
  await screen.getByRole("button", { name: "切换设置", exact: true }).click();
  await expect.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(node => node.getBoundingClientRect().height > 0)).toBe(false);
  await page.viewport(1440, 900);
});

it.each([320, 1280])("%ipx 底栏入口在设置右侧排列且没有通知按钮", async (width) => {
  await page.viewport(width, 800);
  const screen = await render(<TooltipProvider><div style={{ width: 280 }}><SidebarFooter labels={labels} version="1.0.0" onSettings={vi.fn()} onAbout={vi.fn()}>
    <SidebarIconLink label="定时任务"><a href="#scheduled">定</a></SidebarIconLink>
    <SidebarIconLink label="扩展中心"><a href="#extensions">扩</a></SidebarIconLink>
  </SidebarFooter></div></TooltipProvider>);
  const settings = screen.getByRole("button", { name: "设置", exact: true }).element().getBoundingClientRect();
  const scheduled = screen.getByRole("link", { name: "定时任务", exact: true }).element().getBoundingClientRect();
  const extensions = screen.getByRole("link", { name: "扩展中心", exact: true }).element().getBoundingClientRect();
  expect(scheduled.left).toBeGreaterThanOrEqual(settings.right);
  expect(extensions.left).toBeGreaterThanOrEqual(scheduled.right);
  expect(extensions.top).toBe(settings.top);
  expect(extensions.right).toBeLessThan(width);
  expect(screen.getByRole("button", { name: /通知/ }).query()).toBeNull();
  await page.viewport(1440, 900);
});
