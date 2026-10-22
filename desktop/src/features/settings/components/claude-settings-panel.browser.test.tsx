import { Toaster } from "@codexly/ui/core/toaster";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DEFAULT_CLAUDE_SETTINGS } from "@codexly/protocol";
import {
  ClaudeSettingsPanel,
  type ClaudeSettingsClient,
} from "@codexly/ui/core/claude-settings-panel";
import { claudeSettingsChinese as labels } from "@codexly/frontend-core/claude-settings-labels";
import { SettingsSaveFeedbackProvider } from "@codexly/ui/core/settings-save-status";
import {
  SettingsField as Field,
  SettingsGroup as Group,
  SettingsSelect as Select,
} from "./global-settings-fields.js";

function clientWithUnavailableDiscovery(): ClaudeSettingsClient {
  return {
    getClaudeSettings: vi.fn(async () => DEFAULT_CLAUDE_SETTINGS),
    getEngineProfile: vi.fn(async () => {
      throw new Error("SDK unavailable");
    }),
    configureEngine: vi.fn(),
    disconnectEngine: vi.fn(),
    updateClaudeSettings: vi.fn(async (value) => value),
  };
}

it("个性化独立读取，不探测模型；返回不提交未修改的设置", async () => {
  const client = clientWithUnavailableDiscovery(),
    onBack = vi.fn();
  const screen = await render(
    <SettingsSaveFeedbackProvider onBack={onBack}>
      {(back) => (
        <>
          <Toaster />
          <button onClick={back}>返回</button>
          <ClaudeSettingsPanel
            client={client}
            section="claude-personalization"
            title="个性化"
            labels={labels}
            Field={Field}
            Group={Group}
            Select={Select}
          />
        </>
      )}
    </SettingsSaveFeedbackProvider>,
  );
  await expect.element(screen.getByRole("textbox", { name: "全局指令" })).toBeEnabled();
  expect(client.getEngineProfile).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "返回", exact: true }).click();
  await vi.waitFor(() => expect(onBack).toHaveBeenCalledOnce());
  expect(client.updateClaudeSettings).not.toHaveBeenCalled();
});

it("模型探测未结束时仍能配置 API，不能把能力发现当成配置读取的前置条件", async () => {
  const client: ClaudeSettingsClient = {
    ...clientWithUnavailableDiscovery(),
    getEngineProfile: vi.fn(() => new Promise<never>(() => {})),
  };
  const screen = await render(
    <ClaudeSettingsPanel
      client={client}
      section="claude-provider"
      title="模型服务"
      labels={labels}
      Field={Field}
      Group={Group}
      Select={Select}
    />,
  );
  await expect.element(screen.getByRole("textbox", { name: "API 地址" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "保存连接" })).toBeEnabled();
});

it.each(["rejected", "pending"])(
  "模型映射已保存时，能力刷新 %s 不影响保存回执",
  async (discovery) => {
    const client: ClaudeSettingsClient = {
      ...clientWithUnavailableDiscovery(),
      ...(discovery === "pending"
        ? { getEngineProfile: vi.fn(() => new Promise<never>(() => {})) }
        : {}),
    };
    const screen = await render(
      <><Toaster /><ClaudeSettingsPanel
        client={client}
        section="claude-agent"
        title="智能体配置"
        labels={labels}
        Field={Field}
        Group={Group}
        Select={Select}
      /></>,
    );
    const mapping = screen.getByRole("textbox", { name: "Opus 模型映射" });
    await expect.element(mapping).toBeEnabled();
    await mapping.fill("gateway-opus");
    await vi.waitFor(() =>
      expect(client.updateClaudeSettings).toHaveBeenCalledWith(
        expect.objectContaining({ modelAliases: { opus: "gateway-opus", sonnet: "", haiku: "" } }),
      ),
    );
    await expect.element(screen.getByText("已保存", { exact: true })).not.toBeInTheDocument();
    mapping.element().blur();
    await expect.element(screen.getByText("已保存", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByText("保存失败，请重试", { exact: true }))
      .not.toBeInTheDocument();
  },
);
