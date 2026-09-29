import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ProjectCreateDialog } from "./project-create-dialog.js";
import "../../../shared/styles/globals.css";

afterEach(() => localStorage.removeItem("codexly:desktop:new-project-parent:v1"));

it("keeps the folder name when returning from the parent picker and requires explicit reuse", async () => {
  await i18n.changeLanguage("zh-CN");
  const client = {
    listProjectDirectories: vi.fn(async () => ({ path: "/work", parentPath: "/", roots: [], entries: [{ name: "apps", path: "/work/apps" }] })),
    createProjectDirectory: vi.fn(async () => ({ path: "/work/demo", status: "exists-directory" as const })),
  };
  const onAdd = vi.fn(async () => true);
  const onClose = vi.fn();
  const screen = await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={new QueryClient()}><TooltipProvider>
    <ProjectCreateDialog client={client} onAdd={onAdd} onClose={onClose} />
  </TooltipProvider></QueryClientProvider></I18nextProvider>);
  await screen.getByRole("textbox", { name: "文件夹名称" }).fill("demo");
  await screen.getByRole("button", { name: "选择…" }).click();
  await expect.element(screen.getByRole("dialog", { name: "选择父文件夹" })).toBeVisible();
  await screen.getByRole("button", { name: "返回", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "文件夹名称" })).toHaveValue("demo");
  await expect.poll(() => getComputedStyle(document.querySelector('[role="dialog"]')!).opacity).toBe("1");
  await page.screenshot({ path: "../../../../test-results/new-project-desktop.png" });
  await screen.getByRole("button", { name: "创建并添加" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("同名文件夹已存在");
  expect(onAdd).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "添加已有文件夹" }).click();
  expect(client.createProjectDirectory).toHaveBeenCalledOnce();
  expect(onAdd).toHaveBeenCalledExactlyOnceWith(["/work/demo"]);
  expect(onClose).toHaveBeenCalledOnce();
});
