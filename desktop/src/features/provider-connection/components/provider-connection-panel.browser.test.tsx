import type { AgentProviderConnectionStatus } from "@/protocol/index.js";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n, useTranslation } from "../../../i18n/i18n.js";
import { ProviderConnectionPanelView } from "./provider-connection-panel.js";
import type { CustomModelDraft } from "./custom-model-editor.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { SettingsPageFrame } from "../../settings/components/settings-page-frame.js";
import "../../../shared/styles/globals.css";

function ProviderConnectionHarness({
  onConfigure,
  status = { account: null, customBaseUrl: null, mode: "official", pendingLogin: null, state: "disconnected" },
  isBusy = false,
  onLogin = () => undefined,
  onCancel = () => undefined,
  onLogout = () => undefined,
}: Readonly<{
  onConfigure: (input: { apiKey: string; baseUrl: string }) => void;
  status?: AgentProviderConnectionStatus;
  isBusy?: boolean;
  onLogin?: () => void;
  onCancel?: () => void;
  onLogout?: () => void;
}>) {
  const { t } = useTranslation("settings");
  const [mode, setMode] = useState<"custom" | "official">("official");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [models, setModels] = useState<readonly CustomModelDraft[]>([]);
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
      <div style={{ height: "100dvh" }}>
      <SettingsPageFrame activeSection="provider" onBack={() => undefined} onSectionChange={() => undefined}>
      <h1 className="mb-6 text-xl font-semibold">{t("sections.provider")}</h1>
      <ProviderConnectionPanelView
        apiKey={apiKey}
        baseUrl={baseUrl}
        error={null}
        isBusy={isBusy}
        mode={mode}
        models={models}
        onAddModel={() => setModels((current) => [...current, { key: crypto.randomUUID(), id: "", name: "" }])}
        onApiKeyChange={setApiKey}
        onBaseUrlChange={setBaseUrl}
        onCancelLogin={onCancel}
        onConfigureCustom={() => {
          onConfigure({ apiKey, baseUrl });
        }}
        onLogout={onLogout}
        onModelChange={(key, field, value) => setModels((current) => current.map((model) => model.key === key ? { ...model, [field]: value } : model))}
        onModeChange={setMode}
        onRemoveModel={(key) => setModels((current) => current.filter((model) => model.key !== key))}
        onRetry={() => undefined}
        onStartOfficialLogin={onLogin}
        status={status}
      />
      </SettingsPageFrame>
      </div>
      </TooltipProvider>
    </I18nextProvider>
  );
}

describe("ProviderConnectionPanelView", () => {
  it("通过真实输入与点击提交自定义 Provider 配置", async () => {
    await i18n.changeLanguage("zh-CN");
    const onConfigure = vi.fn();
    const screen = await render(<ProviderConnectionHarness onConfigure={onConfigure} />);

    await screen.getByRole("button", { name: "自定义 API" }).click();
    await screen.getByRole("textbox", { name: "API Base URL" }).fill("https://gateway.test/v1");
    await screen.getByLabelText("API Key（可选）").fill("sk-browser-test");
    await screen.getByRole("button", { name: "显示密钥" }).click();
    await expect.element(screen.getByLabelText("API Key（可选）")).toHaveAttribute("type", "text");
    await screen.getByRole("button", { name: "隐藏密钥" }).click();
    await expect.element(screen.getByLabelText("API Key（可选）")).toHaveAttribute("type", "password");
    await screen.getByRole("button", { name: "连接" }).click();

    expect(onConfigure).toHaveBeenCalledWith({
      apiKey: "sk-browser-test",
      baseUrl: "https://gateway.test/v1",
    });
  });

  it("添加模型后阻止不完整配置，并在删除后恢复自动获取", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<ProviderConnectionHarness onConfigure={vi.fn()} />);
    await screen.getByRole("button", { name: "自定义 API" }).click();
    await expect.element(screen.getByText("自动获取模型")).toBeVisible();
    await screen.getByRole("button", { name: "添加模型" }).click();
    await expect.element(screen.getByRole("button", { name: "连接", exact: true })).toBeDisabled();
    await screen.getByRole("textbox", { name: "模型 ID", exact: true }).fill("gpt-5.4");
    await screen.getByRole("textbox", { name: "模型名称", exact: true }).fill("GPT-5.4");
    await expect.element(screen.getByRole("button", { name: "连接", exact: true })).toBeEnabled();
    await screen.getByRole("button", { name: "删除模型" }).click();
    await expect.element(screen.getByText("自动获取模型")).toBeVisible();
  });

  it("官方接入按连接状态显示登录、取消和退出操作", async () => {
    await i18n.changeLanguage("zh-CN");
    const onLogin = vi.fn();
    const onCancel = vi.fn();
    const onLogout = vi.fn();
    const props = { onConfigure: vi.fn(), onLogin, onCancel, onLogout };
    const screen = await render(<ProviderConnectionHarness {...props} />);
    await screen.getByRole("button", { name: "使用 ChatGPT 登录" }).click();
    expect(onLogin).toHaveBeenCalledOnce();
    const status: AgentProviderConnectionStatus = { mode: "official", state: "pending", account: null, customBaseUrl: null, pendingLogin: { loginId: "test", state: "pending", error: null } };
    await screen.rerender(<ProviderConnectionHarness {...props} status={status} />);
    await screen.getByRole("button", { name: "取消登录" }).click();
    expect(onCancel).toHaveBeenCalledOnce();
    await screen.rerender(<ProviderConnectionHarness {...props} status={{ ...status, state: "connected", pendingLogin: null, account: { type: "chatgpt", email: "developer@example.com", planType: "plus" } }} />);
    await expect.element(screen.getByText("developer@example.com")).toBeVisible();
    await screen.getByRole("button", { name: "退出登录" }).click();
    expect(onLogout).toHaveBeenCalledOnce();
    await screen.rerender(<ProviderConnectionHarness {...props} isBusy />);
    await expect.element(screen.getByRole("button", { name: "自定义 API" })).toBeDisabled();
  });

  it("在中英文明暗主题和桌面尺寸下保持表单完整可用", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(<ProviderConnectionHarness onConfigure={vi.fn()} />);
    await page.screenshot({ path: "../../../../test-results/provider-official.png" });
    await screen.getByRole("button", { name: "自定义 API" }).click();
    await screen.getByRole("button", { name: "添加模型" }).click();
    await screen.getByRole("textbox", { name: "模型 ID", exact: true }).fill("gpt-5.4");
    await screen.getByRole("textbox", { name: "模型名称", exact: true }).fill("GPT-5.4");
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      for (const language of ["zh-CN", "en"]) {
        await i18n.changeLanguage(language);
        for (const theme of ["light", "dark"]) {
          document.documentElement.dataset.theme = theme;
          for (const [width, height] of [[1280, 720], [1920, 1080]] as const) {
            await page.viewport(width, height);
            const main = screen.getByRole("main").element();
            expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
            for (const input of main.querySelectorAll("input")) {
              const bounds = input.getBoundingClientRect();
              expect(bounds.width).toBeGreaterThan(100);
              expect(bounds.right).toBeLessThanOrEqual(width);
            }
            await page.screenshot({ path: `../../../../test-results/provider-${language}-${theme}-${width}.png` });
          }
        }
      }
    } finally {
      document.documentElement.dataset.theme = "light";
      await i18n.changeLanguage("zh-CN");
      await page.viewport(1440, 900);
    }
  });
});
