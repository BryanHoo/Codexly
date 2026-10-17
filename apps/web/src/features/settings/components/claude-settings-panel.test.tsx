import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeSettingsPanel,
  type ClaudeSettingsClient,
} from "@codexly/ui/core/claude-settings-panel";
import { claudeSettingsChinese as engineChinese } from "@codexly/frontend-core/claude-settings-labels";
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
  it("shows three explicit family mappings and explains effort separately", async () => {
    const { ClaudeRuntimeSettingsFields } =
      await import("@codexly/ui/core/claude-runtime-settings-fields");
    const { DEFAULT_CLAUDE_SETTINGS } = await import("@codexly/protocol");
    const markup = renderToStaticMarkup(
      <ClaudeRuntimeSettingsFields
        settings={DEFAULT_CLAUDE_SETTINGS}
        models={[]}
        disabled={false}
        labels={engineChinese}
        Group={SettingsGroup}
        Field={SettingsField}
        Select={SettingsSelect}
        onChange={() => undefined}
      />,
    );
    for (const name of ["Opus", "Sonnet", "Haiku"]) expect(markup).toContain(`aria-label="${name}`);
    expect(markup).toContain("模型映射");
    expect(markup).toContain('value="" selected=""');
  });
  it.each([
    ["claude-provider", "API 地址", ["模型", "全局指令", "自动允许"]],
    [
      "claude-personalization",
      "全局指令",
      ["API 地址", "模型", "工具权限", "自动允许", "禁止使用"],
    ],
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
    if (section !== "claude-provider") expect(markup).not.toContain('type="submit"');
    expect(markup).toContain(field);
    for (const label of excluded) expect(markup).not.toContain(`aria-label="${label}"`);
  });
});

describe("首次启动引擎选择", () => {
  it("reads existing setup before invoking runtime preparation or configuration", async () => {
    const { EngineSetupGate } = await import("@codexly/ui/core/engine-setup-gate");
    const prepare = vi.fn();
    const check = vi.fn();
    const renderConfiguration = vi.fn();
    const markup = renderToStaticMarkup(
      <EngineSetupGate
        discover={vi.fn()}
        language="zh-CN"
        storage={{
          getItem: () => JSON.stringify({ engines: ["claude"], complete: false }),
          setItem: vi.fn(),
        }}
        prepare={prepare}
        check={check}
        renderConfiguration={renderConfiguration}
      >
        <p>工作区</p>
      </EngineSetupGate>,
    );
    expect(markup).toContain("正在读取配置");
    expect(markup).not.toContain("工作区");
    expect(prepare).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(renderConfiguration).not.toHaveBeenCalled();
  });
  it("restores completed choices without preparing or asking for Codex login", async () => {
    const { EngineSetupGate } = await import("@codexly/ui/core/engine-setup-gate");
    const prepare = vi.fn();
    const check = vi.fn();
    const markup = renderToStaticMarkup(
      <EngineSetupGate
        discover={vi.fn()}
        language="zh-CN"
        storage={{
          getItem: () => JSON.stringify({ engines: ["claude"], complete: true }),
          setItem: vi.fn(),
        }}
        prepare={prepare}
        check={check}
        renderConfiguration={vi.fn()}
      >
        {(engines) => <p>{engines.join(",")} 工作区</p>}
      </EngineSetupGate>,
    );
    expect(markup).toContain("claude 工作区");
    expect(prepare).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
});
