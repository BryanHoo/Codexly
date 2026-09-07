import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { ExtensionCenterNav, normalizeExtensionSection } from "./extension-center-nav.js";

describe("ExtensionCenterNav", () => {
  it("normalizes routes and renders all extension sections", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(normalizeExtensionSection(undefined)).toBe("skills");
    expect(normalizeExtensionSection("plugins")).toBe("plugins");
    expect(normalizeExtensionSection("unknown")).toBe("skills");

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ExtensionCenterNav active="skills" onSelect={() => undefined} />
      </I18nextProvider>,
    );
    expect(markup).toContain("Skills 管理");
    expect(markup).toContain("MCP 管理");
    expect(markup).toContain("官方插件");
    expect(markup).toContain("三方市场");
    expect(markup).toContain('role="tablist"');
  });
});
