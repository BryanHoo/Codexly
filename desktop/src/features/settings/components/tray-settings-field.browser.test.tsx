import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@codexly/ui/core/toaster";
import { toast } from "@codexly/ui/core/notifications";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import "../../../i18n/settings-general.js";
import { TraySettingsField } from "./tray-settings-field.js";

const commands = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/platform/tauri/tray-client.js", () => ({
  getTrayIconVisible: commands.get,
  setTrayIconVisible: commands.set,
}));

describe("TraySettingsField", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    toast.dismiss();
    await i18n.changeLanguage("zh-CN");
    commands.get.mockResolvedValue(true);
    commands.set.mockImplementation(async (visible: boolean) => {
      commands.get.mockResolvedValue(visible);
      return visible;
    });
  });

  async function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={client}><Toaster /><TraySettingsField /></QueryClientProvider>);
  }

  it("shows the native preference and allows hiding and showing the icon", async () => {
    const screen = await mount();
    const toggle = screen.getByRole("switch", { name: "显示状态栏图标" });
    await expect.element(toggle).toBeEnabled();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
    expect(commands.set).toHaveBeenLastCalledWith(false, expect.anything());
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("loads the saved hidden state", async () => {
    commands.get.mockResolvedValue(false);
    const screen = await mount();
    await expect.element(screen.getByRole("switch", { name: "显示状态栏图标" })).toHaveAttribute("aria-checked", "false");
    expect(commands.set).not.toHaveBeenCalled();
  });

  it("preserves the saved state on failure and retries the requested value", async () => {
    commands.set.mockRejectedValueOnce(new Error("write failed"));
    const screen = await mount();
    const toggle = screen.getByRole("switch", { name: "显示状态栏图标" });
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await expect.element(screen.getByText("保存失败，请重试", { exact: true })).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
    await screen.getByRole("button", { name: "重试" }).click();
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("disables writes on a read failure and allows reloading", async () => {
    commands.get.mockRejectedValueOnce(new Error("read failed"));
    const screen = await mount();
    const toggle = screen.getByRole("switch", { name: "显示状态栏图标" });
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(toggle).toBeDisabled();
    await screen.getByRole("button", { name: "重试" }).click();
    await expect.element(toggle).toBeEnabled();
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  });
});
