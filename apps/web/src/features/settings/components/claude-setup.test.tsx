import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ClaudeSettingsPanel } from "@codexly/ui/core/claude-settings-panel";
import { claudeSettingsChinese as labels } from "@codexly/frontend-core/claude-settings-labels";
import {
  SettingsField as Field,
  SettingsGroup as Group,
  SettingsSelect as Select,
} from "./global-settings-fields.js";

it("initial setup only presents connection fields and a single continue action", () => {
  const markup = renderToStaticMarkup(
    <ClaudeSettingsPanel
      client={{
        getEngineProfile: vi.fn(),
        getClaudeSettings: vi.fn(),
        updateClaudeSettings: vi.fn(),
        configureEngine: vi.fn(),
        disconnectEngine: vi.fn(),
      }}
      labels={labels}
      Field={Field}
      Group={Group}
      Select={Select}
      section="claude-provider"
      title="模型服务"
      onConnected={vi.fn()}
      continueLabel="开始使用"
    />,
  );
  expect(markup).not.toContain("<h1");
  expect(markup).not.toContain("高级");
  expect(markup).not.toContain("模型映射");
  expect(markup).not.toContain("思考强度");
  expect(markup).not.toContain("保存连接");
  expect(markup).toContain("开始使用");
  expect(markup).not.toContain("认证方式");
  expect(markup).not.toContain("<select");
  expect(markup).toContain("输入服务商提供的 API Key 或 Token");
});

it("Claude only exposes API credentials without an account login mode", () => {
  const markup = renderToStaticMarkup(
    <ClaudeSettingsPanel
      client={{
        getEngineProfile: vi.fn(),
        getClaudeSettings: vi.fn(),
        updateClaudeSettings: vi.fn(),
        configureEngine: vi.fn(),
        disconnectEngine: vi.fn(),
      }}
      labels={labels}
      Field={Field}
      Group={Group}
      Select={Select}
      section="claude-provider"
      title="模型服务"
    />,
  );
  expect(markup).not.toContain("Claude 账号");
  expect(markup).not.toContain("claude auth login");
  expect(markup).toContain("API 地址");
});
