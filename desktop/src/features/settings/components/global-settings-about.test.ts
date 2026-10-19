import type { AppInfoResponse } from "@/protocol/index.js";
import { settingsSectionSearchKeys } from "@codexly/frontend-core/settings-navigation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { i18n } from "../../../i18n/i18n.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";

const appInfo = {
  appVersion: "0.1.0",
  changelogUrl: "https://github.com/BryanHoo/Codexly/blob/main/CHANGELOG.md",
  codexVersion: "0.163.0",
  latestVersion: null,
  releaseNotes: "",
  releaseNotesVersion: "0.1.0",
  repositoryUrl: "https://github.com/BryanHoo/Codexly",
  status: "current",
  updateAvailable: false,
} satisfies AppInfoResponse;

describe("GlobalSettingsAbout versions", () => {
  it.each([
    ["zh-CN", "Claude 版本"],
    ["en", "Claude version"],
  ] as const)("indexes the localized Claude version in About for %s", async (language, query) => {
    await i18n.changeLanguage(language);
    const labels = settingsSectionSearchKeys.about.map((key) => i18n.t(key, { ns: "settings" }));
    expect(labels).toContain(query);
    expect(labels.some((label) => label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).toBe(true);
  });

  it.each(["zh-CN", "en"] as const)(
    "localizes the Claude version and missing/null placeholders in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      const label = language === "en" ? "Claude version" : "Claude 版本";
      const codexLabel = language === "en" ? "Codex version" : "Codex 版本";
      const githubLabel = language === "en" ? "Project GitHub" : "项目 GitHub";
      const unknown = language === "en" ? "Unknown" : "未知";
      // 使用非浏览器渲染覆盖正常版本、旧响应省略字段和显式 null，不启动 WebView。
      for (const versionFields of [{ claudeVersion: "2.1.300" }, {}, { claudeVersion: null }]) {
        const markup = renderToStaticMarkup(
          createElement(GlobalSettingsAbout, {
            activeSection: "about",
            appInfo: { ...appInfo, ...versionFields },
            error: null,
            isPending: false,
            onExportDiagnostics: vi.fn(async () => ({ status: "cancelled" as const })),
            onRetry: vi.fn(),
            onUpdate: vi.fn(),
          }),
        );
        expect(markup).toContain(label);
        expect(markup).toContain(
          `<span class="font-mono text-body-small text-foreground">${versionFields.claudeVersion ?? unknown}</span>`,
        );
        expect(markup.indexOf(label)).toBeGreaterThan(markup.indexOf(codexLabel));
        expect(markup.indexOf(label)).toBeLessThan(markup.indexOf(githubLabel));
      }
    },
  );
});
