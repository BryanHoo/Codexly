import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeSettingsPanel,
  type ClaudeSettingsClient,
} from "@codexly/ui/core/claude-settings-panel";
import { engineChinese } from "@codexly/frontend-core/engine-labels";
import { SettingsField, SettingsGroup, SettingsSelect } from "./global-settings-fields.js";

describe("Claude 设置控件", () => {
  it("使用设置页选择器约束模型、思考强度与权限，加载期间禁止编辑连接", () => {
    const client: ClaudeSettingsClient = {
      getEngineProfile: vi.fn(),
      configureEngine: vi.fn(),
      disconnectEngine: vi.fn(),
      getClaudeSettings: vi.fn(),
      updateClaudeSettings: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <ClaudeSettingsPanel
        client={client}
        section="claude-agent"
        title="智能体配置"
        labels={engineChinese}
        Group={SettingsGroup}
        Field={SettingsField}
        Select={SettingsSelect}
      />,
    );
    expect(markup).not.toContain("<datalist");
    expect(markup).not.toContain('type="submit"');
    expect(markup.match(/<select\b/g)).toHaveLength(3);
    expect(markup).not.toContain('aria-label="API 地址"');
    expect(markup).not.toContain('aria-label="全局指令"');
    expect(markup).toContain('role="status"');
    // 服务端渲染不会读取本机配置；读取只能发生在用户实际打开面板之后。
    expect(client.getClaudeSettings).not.toHaveBeenCalled();
  });
  it.each([
    ["claude-provider", "API 地址", ["模型", "全局指令", "自动允许"]],
    ["claude-personalization", "全局指令", ["API 地址", "模型", "工具权限"]],
  ] as const)("%s 只展示当前菜单的字段", (section, field, excluded) => {
    const client: ClaudeSettingsClient = {
      getEngineProfile: vi.fn(),
      configureEngine: vi.fn(),
      disconnectEngine: vi.fn(),
      getClaudeSettings: vi.fn(),
      updateClaudeSettings: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <ClaudeSettingsPanel
        client={client}
        section={section}
        title="Claude 设置"
        labels={engineChinese}
        Group={SettingsGroup}
        Field={SettingsField}
        Select={SettingsSelect}
      />,
    );
    expect(markup).toContain(`id="settings-panel-${section}"`);
    expect(markup).not.toContain('type="submit"');
    expect(markup).toContain(`aria-label="${field}"`);
    for (const label of excluded) expect(markup).not.toContain(`aria-label="${label}"`);
  });
});
