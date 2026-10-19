import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsPageFrame } from "./settings-page-frame.js";
import { changeAppLanguage, i18n } from "../../../i18n/i18n.js";
import { settingsSectionSearchKeys } from "@codexly/frontend-core/settings-navigation";

describe("SettingsPageFrame", () => {
  it.each([
    ["zh-CN", "Claude 版本"],
    ["en", "Claude version"],
  ] as const)("indexes the localized Claude version in About for %s", async (language, query) => {
    await changeAppLanguage(language);
    const labels = settingsSectionSearchKeys.about.map((key) => i18n.t(key, { ns: "settings" }));
    expect(labels).toContain(query);
    // 搜索使用本地化字段标签，不能只匹配菜单已有的 Claude 引擎名称。
    expect(
      labels.some((label) => label.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    ).toBe(true);
  });

  it("展示独立设置页面、搜索与分组导航，并保留局域网入口", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SettingsPageFrame
        activeSection="appearance"
        accessMode="lan"
        onBack={vi.fn()}
        onSectionChange={vi.fn()}
      >
        <p>内容</p>
      </SettingsPageFrame>,
    );
    expect(markup).not.toContain('role="dialog"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain("返回应用");
    expect(markup).toContain("个性化");
    expect(markup).toContain("局域网访问");
    expect(markup).toContain('aria-current="page"');
  });

  it("将两种引擎放入独立菜单，并将 Git 配置归入公共菜单", async () => {
    await changeAppLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <SettingsPageFrame activeSection="appearance" onBack={vi.fn()} onSectionChange={vi.fn()}>
        <p>内容</p>
      </SettingsPageFrame>,
    );
    expect(markup).toContain('aria-label="Codex"');
    expect(markup).toContain('aria-label="Claude"');
    expect(markup).toContain("辅助生成");
    const claude = markup.slice(
      markup.indexOf('role="group" aria-label="Claude"'),
      markup.indexOf('role="group" aria-label="应用"'),
    );
    for (const label of ["模型服务", "智能体配置", "个性化"]) expect(claude).toContain(label);
    expect(claude).not.toContain("Claude Agent");
    expect(markup).not.toContain(">编码<");
  });
});
