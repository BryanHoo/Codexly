import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Toaster } from "@codexly/ui/core/toaster";
import { notificationStore, toast } from "@codexly/ui/core/notifications";
import { SettingsSaveFeedbackProvider, SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
import { useState } from "react";
import "../../shared/styles/globals.css";

afterEach(() => toast.dismiss());

it("通知完整展开且互不重叠，宽窄屏均不溢出并支持独立关闭", async () => {
  await render(<Toaster containerAriaLabel="通知" closeButtonAriaLabel="关闭通知" />);
  for (const width of [1280, 320]) {
    await page.viewport(width, 800);
    for (const message of ["一", "服务请求失败：401 Unauthorized", "正在重新连接本地服务…", "服务配置已保存"]) toast.info(message);
    await expect.poll(() => document.querySelectorAll("[data-toast]").length).toBe(3);
    const cards = [...document.querySelectorAll<HTMLElement>("[data-toast]")];
    const boxes = cards.map((card) => card.getBoundingClientRect());
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    expect(boxes[0]!.bottom).toBeLessThan(boxes[1]!.top);
    expect(boxes[1]!.bottom).toBeLessThan(boxes[2]!.top);
    await page.getByRole("button", { name: "关闭通知" }).first().click();
    await expect.poll(() => document.querySelectorAll("[data-toast]").length).toBe(2);
    toast.dismiss();
  }
  await page.viewport(1440, 900);
});

it("设置输入过程中暂缓保存结果，失焦后仅通过通用通知反馈且自动过期", async () => {
  const retry = vi.fn();
  function Settings() {
    const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    return <SettingsSaveFeedbackProvider>
      <input aria-label="测试输入" onChange={() => { setStatus("saving"); queueMicrotask(() => setStatus("saved")); }} />
      <button type="button" data-save-state={status} onClick={() => setStatus("error")}>模拟失败</button>
      <SettingsSaveStatus status={status} labels={{ saving: "保存中…", saved: "已保存", saveError: "保存失败，请重试", retry: "重试" }} onRetry={retry} />
    </SettingsSaveFeedbackProvider>;
  }
  const screen = await render(<><Toaster /><Settings /></>);
  await screen.getByRole("textbox", { name: "测试输入" }).fill("连续编辑");
  await expect.element(screen.getByRole("button", { name: "模拟失败" })).toHaveAttribute("data-save-state", "saved");
  await expect.poll(() => notificationStore.getSnapshot().length).toBe(0);
  screen.getByRole("textbox").element().blur();
  await expect.element(page.getByText("已保存", { exact: true })).toBeVisible();
  expect(document.querySelectorAll("[data-toast]")).toHaveLength(1);
  await expect.poll(() => notificationStore.getSnapshot().length, { timeout: 3500 }).toBe(0);
  await screen.getByRole("button", { name: "模拟失败" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("保存失败，请重试");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  expect(retry).toHaveBeenCalledOnce();
});

it("失败通知关闭后，返回保护仍重新提供重试入口", async () => {
  const back = vi.fn();
  const retry = vi.fn();
  await render(<><Toaster /><SettingsSaveFeedbackProvider onBack={back}>
    {(requestBack) => <>
      <button type="button" onClick={requestBack}>返回</button>
      <SettingsSaveStatus status="error" labels={{ saving: "保存中…", saved: "已保存", saveError: "保存失败，请重试", retry: "重试" }} onRetry={retry} />
    </>}
  </SettingsSaveFeedbackProvider></>);
  await expect.element(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "关闭通知" }).click();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  expect(back).not.toHaveBeenCalled();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  expect(retry).toHaveBeenCalledOnce();
});
