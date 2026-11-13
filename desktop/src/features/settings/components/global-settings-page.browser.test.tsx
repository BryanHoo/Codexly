import { Toaster } from "@codexly/ui/core/toaster";
import type { AgentGlobalSettings } from "@/protocol/index.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpDefaults } from "@codexly/protocol";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { GlobalSettingsPage } from "./global-settings-page.js";
import { createFallbackSettings } from "./global-settings-model.js";
import { getNotificationPreference } from "../notification-preference.js";
import { nativeClient } from "../../projects/project-queries.js";
import "../../../shared/styles/globals.css";

vi.mock("@/platform/tauri/autostart-client.js", () => ({
  getAutostartEnabled: vi.fn(async () => false),
  setAutostartEnabled: vi.fn(async (enabled: boolean) => enabled),
}));

const models = [
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "",
    isDefault: true,
    inputModalities: ["text" as const],
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"].map((id) => ({ id, description: id })),
  },
];

afterEach(() => vi.restoreAllMocks());

const acpDefaults: AcpDefaults = {
  defaults: {},
  invalidDefaults: [],
  unmappedLegacy: [],
  configOptions: [
    {
      id: "agent-model",
      name: "智能体模型",
      type: "select",
      currentValue: "model-a",
      options: [
        { value: "model-a", name: "模型甲" },
        { value: "model-b", name: "模型乙" },
      ],
    },
    {
      id: "agent-thought",
      name: "思考强度",
      type: "select",
      currentValue: "level-a",
      options: [
        { value: "level-a", name: "普通" },
        { value: "level-b", name: "深入" },
      ],
    },
    {
      id: "agent-policy",
      name: "智能体授权",
      type: "select",
      currentValue: "ask",
      options: [
        { value: "ask", name: "询问" },
        { value: "open", name: "自动" },
      ],
    },
    { id: "agent-switch", name: "智能体开关", type: "boolean", currentValue: false },
  ],
};

async function renderSettings(
  initialSection: "appearance" | "personalization" | "git" = "appearance",
) {
  await i18n.changeLanguage("zh-CN");
  const onClose = vi.fn();
  const onSave = vi.fn(async (_settings: AgentGlobalSettings) => undefined);
  // 整页使用真实原生客户端端口；原始控件由 ACP 返回，不能恢复旧厂商设置夹具。
  let current = structuredClone(acpDefaults);
  vi.spyOn(nativeClient, "getAcpAgent").mockImplementation(async (engine) => ({
    engine,
    protocolVersion: 1,
    authMethods: [],
  }));
  vi.spyOn(nativeClient, "getAcpDefaults").mockImplementation(async () => current);
  const setConfig = vi
    .spyOn(nativeClient, "setAcpDefaultConfig")
    .mockImplementation(async (_engine, id, value) => {
      current = {
        ...current,
        configOptions: current.configOptions.map((option) => {
          if (option.id !== id) return option;
          if (option.type === "boolean" && typeof value === "boolean")
            return { ...option, currentValue: value };
          if (option.type === "select" && typeof value === "string")
            return { ...option, currentValue: value };
          throw new Error("配置类型不匹配");
        }),
      };
      return current;
    });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(["temporary-workspace-settings"], {
    rootPath: "/Users/example/Documents/CodeAgent/Temporary tasks",
  });
  queryClient.setQueryData(["personalization", "instructions"], {
    content: "现有说明",
    path: "/custom/AGENTS.md",
    overrideActive: false,
  });
  queryClient.setQueryData(["personalization", "memories"], {
    enabled: false,
    allowExternalContext: true,
  });
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div style={{ height: "100dvh" }}>
            <Toaster />
            <GlobalSettingsPage
              apps={[]}
              error={null}
              initialSection={initialSection}
              isPending={false}
              models={models}
              onClose={onClose}
              onRetry={vi.fn()}
              onSave={onSave}
              settings={createFallbackSettings(models)}
            />
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await expect
    .element(
      screen.getByRole("heading", {
        name:
          initialSection === "appearance"
            ? "常规"
            : initialSection === "git"
              ? "辅助生成"
              : "Codex",
        exact: true,
      }),
    )
    .toBeVisible();
  return { onClose, onSave, screen, setConfig };
}

describe("GlobalSettingsPage", () => {
  it("uses only the outer search focus ring and displays agent-provided model labels", async () => {
    const { screen } = await renderSettings();
    const input = screen.getByRole("searchbox", { name: "搜索设置" }).element() as HTMLInputElement;
    input.focus();
    expect(input.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(input).outlineStyle).toBe("none");
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");
    expect(getComputedStyle(input.parentElement!).boxShadow).not.toBe("none");
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "智能体模型", exact: true }))
      .toBeVisible();
  });
  it("frames settings groups and keeps labels smaller than section headings", async () => {
    const { screen } = await renderSettings();
    await expect
      .element(screen.getByRole("switch", { name: "开机启动", exact: true }))
      .toBeEnabled();
    const heading = screen.getByRole("heading", { name: "通用", exact: true }).element();
    const group = heading.nextElementSibling as HTMLElement;
    const row = group.firstElementChild as HTMLElement;
    const label = row.querySelector("span")!;
    const description = row.querySelector("p")!;
    const cardStyle = getComputedStyle(group);
    expect(cardStyle.borderLeftWidth).toBe("1px");
    expect(cardStyle.borderRightWidth).toBe("1px");
    expect(Number.parseFloat(cardStyle.borderRadius)).toBe(8);
    expect(Number.parseFloat(getComputedStyle(heading).fontSize)).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(label).fontSize),
    );
    expect(Number.parseFloat(getComputedStyle(label).fontSize)).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(description).fontSize),
    );
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(66);
    expect(
      screen.getByRole("combobox", { name: "默认打开方式" }).element().getBoundingClientRect()
        .height,
    ).toBeLessThanOrEqual(32);
    expect(screen.getByRole("button", { name: "提交消息", exact: true }).all()).toHaveLength(0);
    await screen.getByRole("button", { name: "辅助生成", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: "辅助生成", exact: true }))
      .toBeVisible();
    const panel = document.querySelector("#commitMessagePrompt")!.closest("section")!;
    expect(getComputedStyle(panel).borderLeftWidth).toBe("1px");
    const prompt = screen.getByRole("textbox", { name: "Git message 提示词" }).element();
    expect(prompt.getBoundingClientRect().width).toBeGreaterThan(
      panel.getBoundingClientRect().width * 0.85,
    );
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("提交");
    await expect
      .element(screen.getByRole("button", { name: "辅助生成", exact: true }))
      .toBeVisible();
    await screen.getByRole("searchbox", { name: "搜索设置" }).fill("");
    await page.viewport(1440, 1100);
    await page.screenshot({ path: "../../../../test-results/settings-personalization-commit.png" });
    await page.viewport(1440, 900);
  });
  it("saves raw ACP permissions and boolean preferences independently of legacy settings", async () => {
    const { screen, onSave, setConfig } = await renderSettings();
    expect(screen.getByRole("combobox", { name: "审批", exact: true }).all()).toHaveLength(0);
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    const policy = screen.getByRole("combobox", { name: "智能体授权", exact: true });
    await policy.click();
    await page.getByRole("option", { name: "自动", exact: true }).click();
    await screen.getByRole("heading", { name: "会话默认配置", exact: true }).click();
    await expect.element(policy).toHaveTextContent("自动");
    await expect.poll(() => setConfig.mock.calls.length).toBe(1);
    expect(setConfig).toHaveBeenLastCalledWith(
      "codex",
      "agent-policy",
      "open",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    await screen.getByRole("switch", { name: "智能体开关", exact: true }).click();
    await expect
      .element(screen.getByRole("switch", { name: "智能体开关", exact: true }))
      .toBeChecked();
    await screen.getByRole("heading", { name: "会话默认配置", exact: true }).click();
    await expect.poll(() => setConfig.mock.calls.length).toBe(2);
    expect(setConfig).toHaveBeenLastCalledWith(
      "codex",
      "agent-switch",
      true,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(onSave).not.toHaveBeenCalled();
    for (const term of ["审批", "工作区", "网页搜索", "输出详细程度"]) {
      await screen.getByRole("searchbox", { name: "搜索设置" }).fill(term);
      await expect.element(screen.getByRole("button", { name: "ACP", exact: true })).toBeVisible();
      expect(screen.getByRole("button", { name: "常规", exact: true }).all()).toHaveLength(0);
    }
    await screen.getByRole("button", { name: "清除搜索" }).click();
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    for (const [width, height] of [
      [1280, 720],
      [1920, 1080],
    ] as const) {
      await page.viewport(width, height);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `../../../../test-results/settings-page-agent-${width}.png` });
    }
    document.documentElement.dataset.theme = "dark";
    await page.screenshot({ path: "../../../../test-results/settings-page-agent-dark.png" });
    document.documentElement.dataset.theme = "light";
    await i18n.changeLanguage("en");
    await page.viewport(1280, 720);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: "../../../../test-results/settings-page-agent-en.png" });
    await i18n.changeLanguage("zh-CN");
  });
  it("keeps general preferences and follow-up controls in General", async () => {
    const { screen, onSave } = await renderSettings();
    for (const name of ["通用", "编辑器", "通知"]) {
      await expect.element(screen.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await screen.getByRole("button", { name: "引导", exact: true }).click();
    await expect
      .poll(() => onSave.mock.calls.at(-1)?.[0])
      .toMatchObject({ followUpBehavior: "steer" });
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "引导", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
  });
  it("opens a wide settings modal with navigation", async () => {
    const { screen } = await renderSettings();
    await expect.element(screen.getByRole("main", { name: "全局设置" })).toBeVisible();
    await expect
      .element(screen.getByRole("dialog", { name: "全局设置", exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "智能体模型", exact: true }))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "ACP", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await screen.getByRole("button", { name: "常规", exact: true }).click();

    for (const [width, height] of [
      [1280, 720],
      [1920, 1080],
    ] as const) {
      await page.viewport(width, height);
      const bounds = screen
        .getByRole("dialog", { name: "全局设置" })
        .element()
        .getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(width / 2);
      expect(bounds.height).toBeLessThan(height);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `../../../../test-results/settings-page-${width}.png` });
    }
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    document.documentElement.dataset.theme = "dark";
    await page.screenshot({ path: "../../../../test-results/settings-page-dark.png" });
    document.documentElement.dataset.theme = "light";
    await page.viewport(1440, 900);
    await screen.getByRole("button", { name: "常规", exact: true }).click();
    await page.screenshot({ path: "../../../../test-results/settings-page-general.png" });
    await i18n.changeLanguage("en");
    await page.viewport(1280, 720);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: "../../../../test-results/settings-page-general-en.png" });
    await i18n.changeLanguage("zh-CN");
    await page.viewport(1440, 900);
  });

  it("finds settings by field label and keeps navigation available after clearing search", async () => {
    const { screen } = await renderSettings();
    const search = screen.getByRole("searchbox", { name: "搜索设置" });
    await search.fill("思考强度");
    await expect.element(screen.getByRole("button", { name: "ACP", exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "常规", exact: true }).all()).toHaveLength(0);
    await screen.getByRole("button", { name: "ACP", exact: true }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "思考强度", exact: true }))
      .toBeVisible();
    await search.fill("no-matching-setting");
    await expect.element(screen.getByText("未找到相关设置")).toBeVisible();
    await screen.getByRole("button", { name: "清除搜索" }).click();
    await expect.element(screen.getByRole("button", { name: "常规", exact: true })).toBeVisible();
  });

  it("automatically saves generation rules on blur", async () => {
    const { screen, onSave } = await renderSettings("git");
    const editor = screen.getByRole("textbox", { name: "Git message 提示词" });
    await editor.fill("新的提交规则");
    editor.element().blur();
    await expect
      .poll(() => onSave.mock.calls.at(-1)?.[0])
      .toMatchObject({ commitMessagePrompt: "新的提交规则" });
    expect(screen.getByRole("button", { name: "保存", exact: true }).all()).toHaveLength(0);
  });

  it("preserves generation rules after save failure and allows retry", async () => {
    const { screen, onSave } = await renderSettings("git");
    onSave.mockRejectedValueOnce(new Error("disk unavailable"));
    const editor = screen.getByRole("textbox", { name: "Git message 提示词" });
    await editor.fill("保留规则草稿");
    editor.element().blur();
    await expect
      .element(screen.getByText("保存失败，请重试", { exact: true }))
      .toHaveTextContent("保存失败，请重试");
    await expect.element(editor).toHaveValue("保留规则草稿");
    await screen.getByRole("button", { name: "重试", exact: true }).click();
    await expect.element(screen.getByText("已保存", { exact: true })).toHaveTextContent("已保存");
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("flushes generation rules before leaving settings", async () => {
    const { screen, onClose, onSave } = await renderSettings("git");
    await screen.getByRole("textbox", { name: "Git message 提示词" }).fill("最新规则");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ commitMessagePrompt: "最新规则" }),
    );
  });

  it("closes settings with Escape through the save barrier", async () => {
    const { screen, onClose } = await renderSettings();
    await expect
      .element(screen.getByRole("dialog", { name: "全局设置", exact: true }))
      .toBeVisible();
    await page.getByRole("searchbox", { name: "搜索设置" }).click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await expect.poll(() => onClose.mock.calls.length).toBe(1);
  });

  it("updates the existing notification preference from the General switch", async () => {
    const { screen, onSave } = await renderSettings();
    const initial = getNotificationPreference();
    const toggle = screen.getByRole("switch", { name: "任务通知" });
    await expect.element(toggle).toHaveAttribute("aria-checked", String(initial));
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-checked", String(!initial));
    expect(getNotificationPreference()).toBe(!initial);
    expect(onSave).not.toHaveBeenCalled();
    await toggle.click();
    expect(getNotificationPreference()).toBe(initial);
  });
});
