import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

import { projectLanguageModules, type HighlightLanguage } from "./code-languages.js";
import type { TokenizedCode } from "./code-token-cache.js";

export type { HighlightLanguage } from "./code-languages.js";

const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine({ forgiving: true }),
  langs: [],
  themes: [githubLight, githubDark],
});
const languagePromises = new Map<HighlightLanguage, Promise<HighlighterCore>>();

function getHighlighter(language: HighlightLanguage): Promise<HighlighterCore> {
  const cached = languagePromises.get(language);
  if (cached !== undefined) {
    return cached;
  }

  // 每种语言只注册一次；模块加载失败时移除 Promise，后续渲染仍可重试。
  const loading = Promise.all([highlighterPromise, projectLanguageModules[language]()])
    .then(async ([highlighter, module]) => {
      await highlighter.loadLanguage(module.default);
      return highlighter;
    })
    .catch((error: unknown) => {
      languagePromises.delete(language);
      throw error;
    });
  languagePromises.set(language, loading);
  return loading;
}

export async function highlightCode(
  code: string,
  language: HighlightLanguage,
): Promise<TokenizedCode> {
  const highlighter = await getHighlighter(language);
  const result = highlighter.codeToTokens(code, {
    lang: language,
    themes: { dark: "github-dark", light: "github-light" },
  });

  return {
    background: result.bg ?? "transparent",
    foreground: result.fg ?? "inherit",
    lines: result.tokens,
  };
}
