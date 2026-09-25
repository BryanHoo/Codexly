import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsPage } from "./global-settings-page.js";
import { createFallbackSettings } from "./global-settings-model.js";

const { backgroundRead } = vi.hoisted(() => ({ backgroundRead: vi.fn() }));
vi.mock("../../../platform/tauri/app-storage.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../platform/tauri/app-storage.js")>(),
  appPreferenceStorage: { getItem: () => null, setItem: vi.fn() },
  listNativeCustomBackgrounds: () => { backgroundRead(); return Promise.resolve([]); },
}));

describe("settings lazy loading", () => {
  it("does not read image data until custom background is enabled", async () => {
    await i18n.changeLanguage("zh-CN");
    // 补齐常规设置依赖的查询上下文，并预置临时目录以避免调用原生接口。
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    queryClient.setQueryData(["temporary-workspace-settings"], { rootPath: "/Users/example/Documents/CodeAgent/Temporary tasks" });
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <GlobalSettingsPage apps={[]} error={null} isPending={false} models={[]} onClose={vi.fn()} onRetry={vi.fn()} onSave={async () => undefined} settings={createFallbackSettings([])} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await expect.element(screen.getByRole("heading", { name: "常规", exact: true })).toBeVisible();
    expect(backgroundRead).not.toHaveBeenCalled();
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("记忆");
    await expect.element(screen.getByRole("button", { name: "个性化", exact: true })).toBeVisible();
    expect(backgroundRead).not.toHaveBeenCalled();
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("");
    await screen.getByRole("button", { name: "自定义工作台背景", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "选择图片", exact: true })).toBeVisible();
    await expect.poll(() => backgroundRead.mock.calls.length).toBe(1);
  });
});
