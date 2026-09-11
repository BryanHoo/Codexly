import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsPageFrame } from "./settings-page-frame.js";
import { changeAppLanguage } from "../../../i18n/i18n.js";

describe("SettingsPageFrame", () => {
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
});
