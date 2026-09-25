import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n, useTranslation } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { DEFAULT_WORKBENCH_BACKGROUND, type WorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import { SettingsPageFrame } from "./settings-page-frame.js";
import { WorkbenchBackgroundSettings } from "./workbench-background-settings.js";
import "../../../shared/styles/globals.css";

const native = vi.hoisted(() => ({ listWorkbenchBackgrounds: vi.fn(), getWorkbenchBackground: vi.fn(), downloadWorkbenchBackground: vi.fn() }));
vi.mock("../../projects/project-queries.js", () => ({ nativeClient: native }));
vi.mock("../../../platform/native-asset-url.js", () => ({ buildNativeAssetUrl: (path: string) => path }));

const wallpapers = Array.from({ length: 9 }, (_, index) => ({ day: `2026-09-${String(9 - index).padStart(2, "0")}`, title: `山川与湖泊 ${index + 1}`, copyright: "Bing wallpaper" }));
function imageFixture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 160; canvas.height = 90;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#4296bb"; context.fillRect(0, 0, 160, 50);
  context.fillStyle = "#3d7257"; context.fillRect(0, 50, 160, 40);
  return canvas.toDataURL();
}

function Harness({ onChange = () => undefined, disabled = false, mode = "bing" }: Readonly<{ onChange?: (value: WorkbenchBackgroundPreference) => void; disabled?: boolean; mode?: WorkbenchBackgroundPreference["mode"] }>) {
  const { t } = useTranslation("settings");
  const [preference, setPreference] = useState({ ...DEFAULT_WORKBENCH_BACKGROUND, mode } as WorkbenchBackgroundPreference);
  return <div style={{ height: "100dvh" }}><SettingsPageFrame activeSection="appearance" onBack={() => undefined} onSectionChange={() => undefined}>
    <h1 className="mb-6 text-xl font-semibold">{t("sections.appearance")}</h1>
    <WorkbenchBackgroundSettings preference={preference} onPreferenceChange={(next) => { setPreference(next); onChange(next); }} disabled={disabled} customImages={[]} onCustomFilesAdd={() => undefined} onCustomImageRemove={() => undefined} onCustomImageSelect={() => undefined} />
  </SettingsPageFrame></div>;
}

async function setup(props: Parameters<typeof Harness>[0] = {}, openPicker = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}><TooltipProvider><Harness {...props} /></TooltipProvider></QueryClientProvider></I18nextProvider>);
  if (openPicker) {
    await screen.getByRole("button", { name: "选择图片", exact: true }).click();
    await vi.waitFor(() => {
      if (!screen.getByRole("button", { name: "使用 2026-09-01", exact: true }).query()) throw new Error("Gallery is loading");
    });
  }
  return screen;
}

describe("wallpaper settings", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    vi.clearAllMocks();
    native.listWorkbenchBackgrounds.mockResolvedValue(wallpapers);
    native.getWorkbenchBackground.mockImplementation(async (day: string) => ({ assetPath: import.meta.env.VITE_WALLPAPER_TEST_IMAGES === "1" ? `/test-results/bing-${day}.jpg` : imageFixture() }));
    native.downloadWorkbenchBackground.mockResolvedValue({ status: "cancelled" });
  });

  it("shows nine days, pins a selected date, and restores daily updates", async () => {
    const onChange = vi.fn();
    const screen = await setup({ onChange });
    expect(screen.getByRole("button", { name: /^使用 2026/ }).all()).toHaveLength(9);
    await screen.getByRole("button", { name: "使用 2026-09-01", exact: true }).click();
    await expect.element(screen.getByRole("checkbox", { name: "每日自动更新" })).not.toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedBingDay: "2026-09-01" }));
    await screen.getByRole("checkbox", { name: "每日自动更新" }).click();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedBingDay: null }));
  });

  it("previews and downloads independently without changing the applied wallpaper", async () => {
    const onChange = vi.fn();
    const screen = await setup({ onChange });
    await screen.getByRole("button", { name: "预览 2026-09-01", exact: true }).click();
    await expect.element(screen.getByRole("dialog").last()).toBeVisible();
    await expect.element(screen.getByRole("dialog").last().getByRole("img")).toBeVisible();
    await screen.getByRole("button", { name: "下载原图", exact: true }).click();
    expect(native.downloadWorkbenchBackground).toHaveBeenCalledWith("2026-09-01");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.getByRole("dialog").all().length).toBe(1);
  });

  it("keeps sliders responsive while image mutations are busy and resets appearance", async () => {
    const onChange = vi.fn();
    const screen = await setup({ onChange, disabled: true }, false);
    const slider = screen.getByRole("slider").first();
    await expect.element(slider).toBeEnabled();
    expect(native.listWorkbenchBackgrounds).not.toHaveBeenCalled();
    await page.screenshot({ path: "../../../../test-results/background-bing-summary.png" });
    (slider.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ overlayOpacity: 63 }));
    await screen.getByRole("button", { name: "重置显示效果" }).click();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ overlayOpacity: 60, blurPercentage: 0 }));
  });

  it("hides adjustments without a wallpaper and never renders an effect preview", async () => {
    const screen = await setup({ mode: "none" }, false);
    expect(document.querySelector(".wallpaper-preview")).toBeNull();
    expect(native.getWorkbenchBackground).not.toHaveBeenCalled();
    expect(native.listWorkbenchBackgrounds).not.toHaveBeenCalled();
    expect(screen.getByRole("slider").all()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "选择图片", exact: true }).all()).toHaveLength(0);
    expect(document.querySelector(".wallpaper-settings")!.getBoundingClientRect().height).toBeLessThan(80);
    await screen.getByRole("button", { name: "自定义工作台背景", exact: true }).click();
    expect(screen.getByRole("slider").all()).toHaveLength(2);
    await expect.element(screen.getByRole("button", { name: "选择图片", exact: true })).toBeVisible();
    await page.screenshot({ path: "../../../../test-results/background-custom-summary.png" });
    await screen.getByRole("button", { name: "选择图片", exact: true }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nonblank gallery images across desktop viewports and themes", async () => {
    const screen = await setup();
    await expect.poll(() => document.querySelector<HTMLImageElement>(".wallpaper-thumbnail img")?.naturalWidth ?? 0).toBeGreaterThan(0);
    try {
      for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
        await page.viewport(width, height);
        for (const theme of ["light", "dark"]) {
          document.documentElement.dataset.theme = theme;
          document.getAnimations().forEach((animation) => animation.finish());
          const main = screen.getByRole("dialog").element();
          main.scrollTo(0, 0);
          expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
          expect(main.getBoundingClientRect().height).toBeLessThanOrEqual(height - 64);
          await page.screenshot({ path: `../../../../test-results/wallpaper-${theme}-${width}.png` });
          expect(document.querySelector<HTMLImageElement>(".wallpaper-thumbnail img")!.naturalWidth).toBeGreaterThan(0);
        }
      }
    } finally { document.documentElement.dataset.theme = "light"; await page.viewport(1440, 900); }
  });

  it("shows a retryable error when the original download fails", async () => {
    native.getWorkbenchBackground.mockImplementation(async (_day: string, thumbnail: boolean) => {
      if (!thumbnail) throw new Error("offline");
      return { assetPath: imageFixture() };
    });
    const screen = await setup();
    await screen.getByRole("button", { name: "预览 2026-09-01", exact: true }).click();
    await expect.element(screen.getByRole("dialog").last().getByRole("alert")).toHaveTextContent("图片无法预览");
    native.getWorkbenchBackground.mockResolvedValue({ assetPath: imageFixture() });
    await screen.getByRole("dialog").last().getByRole("button", { name: "重新加载" }).click();
    await expect.element(screen.getByRole("dialog").last().getByRole("img")).toBeVisible();
  });

  it("keeps English controls inside the narrow desktop layout", async () => {
    const screen = await setup();
    try {
      await i18n.changeLanguage("en");
      await page.viewport(1280, 720);
      document.getAnimations().forEach((animation) => animation.finish());
      const main = screen.getByRole("dialog").element();
      main.scrollTo(0, 0);
      expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
      await expect.element(screen.getByRole("checkbox", { name: "Update daily" })).toBeVisible();
      await page.screenshot({ path: "../../../../test-results/wallpaper-en-1280.png" });
    } finally { await i18n.changeLanguage("zh-CN"); await page.viewport(1440, 900); }
  });
});
