import type { WorkbenchPetDescriptor } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import "../../../shared/styles/globals.css";
import { SettingsPageFrame } from "../../settings/components/settings-page-frame.js";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import type { DesktopPetTask } from "../../../protocol/desktop-pet.js";
import "../../../shared/styles/desktop-pet.css";
import { GlobalSettingsPetsView } from "./global-settings-pets.js";
import { WorkbenchPetBubbles } from "./workbench-pet-bubbles.js";

const tasks = [
  {
    projectId: "project-a",
    rootPath: "/workspace/a",
    status: "running",
    taskId: "task-a",
    taskName: "正在执行的任务",
  },
  {
    projectId: "project-b",
    rootPath: "/workspace/b",
    status: "completed",
    taskId: "task-b",
    taskName: "已经完成的任务",
  },
] as const satisfies readonly DesktopPetTask[];

const downloadablePet = {
  animations: {},
  assetId: "a".repeat(64),
  availability: "downloadable",
  description: "测试宠物",
  displayName: "Codex",
  frame: { columns: 1, height: 32, rows: 1, width: 32 },
  id: "codex",
  source: "builtin",
} as const satisfies WorkbenchPetDescriptor;

function PetSettingsHarness() {
  const [settings, setSettings] = useState({ enabled: false, selectedPetId: "codex" });
  return <div style={{ height: "100vh" }}><SettingsPageFrame activeSection="pets" onBack={() => undefined} onSectionChange={() => undefined}>
    <GlobalSettingsPetsView error={null} isLoading={false}
      onEnabledChange={(enabled) => setSettings((current) => ({ ...current, enabled }))}
      onPetSelect={(selectedPetId) => setSettings((current) => ({ ...current, selectedPetId }))}
      onRefresh={() => undefined} settings={settings}
      pets={[downloadablePet, { ...downloadablePet, id: "cat", displayName: "Cat", description: "安静陪伴工作的猫咪" }]} />
  </SettingsPageFrame></div>;
}

describe("桌面宠物控件", () => {
  it("关闭时保留选择，键盘开启并显示清晰状态，菜单使用宠物名称", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<I18nextProvider i18n={i18n}><PetSettingsHarness /></I18nextProvider>);
    await expect.element(screen.getByRole("button", { name: "宠物", exact: true })).toBeVisible();
    await screen.getByRole("radio", { name: /Cat/ }).click();
    await expect.element(screen.getByRole("radio", { name: /Cat/ })).toBeChecked();
    const toggle = screen.getByRole("switch", { name: "启用宠物" });
    await expect.element(toggle).not.toBeChecked();
    (toggle.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(toggle).toBeChecked();
    await expect.element(toggle).toHaveTextContent("已开启");
    await toggle.click();
    await expect.element(toggle).toHaveTextContent("已关闭");
    await expect.element(screen.getByRole("radio", { name: /Cat/ })).toBeChecked();
    try {
      for (const language of ["zh-CN", "en"]) {
        await i18n.changeLanguage(language);
        for (const theme of ["light", "dark"]) {
          document.documentElement.dataset.theme = theme;
          await page.viewport(1280, 800);
          const main = screen.getByRole("main").element();
          expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
          await page.screenshot({ path: `../../../../test-results/pets-${language}-${theme}.png` });
        }
      }
    } finally { await i18n.changeLanguage("zh-CN"); document.documentElement.dataset.theme = "light"; await page.viewport(1440, 900); }
  });

  it("加载失败且目录为空时仍能关闭已启用的宠物", async () => {
    const onEnabledChange = vi.fn();
    const screen = await render(<I18nextProvider i18n={i18n}><GlobalSettingsPetsView
      error={new Error("offline")} isLoading={false} pets={[]} settings={{ enabled: true, selectedPetId: "codex" }}
      onEnabledChange={onEnabledChange} onPetSelect={() => undefined} onRefresh={() => undefined} />
    </I18nextProvider>);
    await screen.getByRole("switch", { name: "启用宠物" }).click();
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("按输入顺序自然排列任务气泡", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <WorkbenchPetBubbles onTaskSelect={() => undefined} tasks={tasks} />
      </I18nextProvider>,
    );
    const bubbles = screen.getByRole("listitem").elements();

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.textContent).toContain("正在执行的任务");
    expect(bubbles[1]?.textContent).toContain("已经完成的任务");
    expect(bubbles[1]!.getBoundingClientRect().top - bubbles[0]!.getBoundingClientRect().bottom).toBe(
      6,
    );
  });

  it("通过明显的开关直接关闭宠物", async () => {
    await i18n.changeLanguage("zh-CN");
    const onEnabledChange = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <GlobalSettingsPetsView
          error={null}
          isLoading={false}
          onEnabledChange={onEnabledChange}
          onPetSelect={() => undefined}
          onRefresh={() => undefined}
          pets={[downloadablePet]}
          settings={{ enabled: true, selectedPetId: "codex" }}
        />
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("heading", { name: "宠物", exact: true })).toBeVisible();
    await expect.element(screen.getByRole("switch", { name: "启用宠物" })).toBeChecked();
    await screen.getByRole("switch", { name: "启用宠物" }).click();

    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});
