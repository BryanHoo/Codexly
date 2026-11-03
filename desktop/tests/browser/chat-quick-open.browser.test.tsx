import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { WorkbenchShellHeader as WebHeader } from "../../../apps/web/src/features/workbench/components/workbench-shell-header.js";
import { WorkbenchShellHeader as DesktopHeader } from "../../src/features/workbench/components/workbench-shell-header.js";
import "../../src/shared/styles/globals.css";

describe.each(["web", "desktop"] as const)("%s 聊天快捷打开", (platform) => {
  it.each([360, 1440])("在 %s px 显示入口并执行默认应用和菜单选择", async (width) => {
    await page.viewport(width, 900);
    const mutateAsync = vi.fn(() => Promise.resolve());
    const context = {
      inspectorOpen: false, sidebarOpen: false, title: "聊天",
      globalSettings: { defaultOpenAppId: "zed" },
      projectOpenCapabilitiesQuery: { isPending: false, data: { apps: [
        { id: "zed", kind: "editor", name: "Zed" },
        { id: "finder", kind: "file-manager", name: "Finder" },
      ] } },
      projectPathOpenMutation: { isPending: false, reset: vi.fn(), mutateAsync },
      projectPathOpenLockRef: { current: { run: (action: () => Promise<unknown>) => action() } },
      t: (key: string) => key,
    };
    const screen = await render(<TooltipProvider>{platform === "web" ? (
      <WebHeader board={false} scheduled={false} skillsMarket={false} temporary projectId="temporary" taskId="chat-a" context={context as unknown as Parameters<typeof WebHeader>[0]["context"]} />
    ) : (
      <DesktopHeader utilityView={false} temporary taskWriteBlocked={false} viewTitle="聊天" projectId="temporary" taskId="chat-a" context={context as unknown as Parameters<typeof DesktopHeader>[0]["context"]} />
    )}</TooltipProvider>);
    const open = screen.getByRole("button", { name: /Zed/u });
    await expect.element(open).toBeVisible();
    await open.click();
    expect(mutateAsync).toHaveBeenLastCalledWith({ appId: "zed", path: undefined });
    await screen.getByRole("button", { name: /选择打开方式|Choose how to open/u }).click();
    await page.getByRole("menuitem", { name: "Finder", exact: true }).click();
    expect(mutateAsync).toHaveBeenLastCalledWith({ appId: "finder", path: undefined });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await screen.unmount();
  });
});
