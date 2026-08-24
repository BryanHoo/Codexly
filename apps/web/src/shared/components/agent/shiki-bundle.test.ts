import { describe, expect, it } from "vitest";

import { getCodeLanguage, projectLanguageModules } from "./code-languages.js";
import { pierreThemes, shikiThemes } from "./pierre-themes.js";
import { bundledLanguages, createHighlighter } from "./shiki-bundle.js";

const supportedLanguages = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "dotenv",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "json5",
  "jsonc",
  "jsx",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "mdx",
  "perl",
  "php",
  "python",
  "ruby",
  "rust",
  "scss",
  "shellscript",
  "sql",
  "svelte",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vue",
  "xml",
  "yaml",
] as const;

describe("Shiki fine-grained bundle", () => {
  it("只公开项目支持的语言模块", () => {
    expect(Object.keys(projectLanguageModules).sort()).toEqual([...supportedLanguages].sort());
    expect(Object.keys(bundledLanguages).sort()).toEqual([...supportedLanguages].sort());
    expect(bundledLanguages).not.toHaveProperty("abap");
  });

  it("让源码查看器与 Diff 共用规范化语言映射", () => {
    expect(getCodeLanguage("src/view.tsx")).toBe("tsx");
    expect(getCodeLanguage("scripts/release.sh")).toBe("shellscript");
    expect(getCodeLanguage("schema/data.yml")).toBe("yaml");
    expect(getCodeLanguage("legacy/task.pl")).toBe("perl");
    expect(getCodeLanguage("README")).toBe("text");
  });

  it("只注册两个 GitHub 主题", () => {
    expect(pierreThemes.getThemeNames()).toEqual([]);
    expect(shikiThemes.getThemeNames()).toEqual(["github-light", "github-dark"]);
  });

  it("使用 Core API 创建纯文本高亮器", async () => {
    const highlighter = await createHighlighter({ langs: ["text"], themes: [] });

    expect(highlighter.getLoadedLanguages()).toEqual([]);
    highlighter.dispose();
  });
});
