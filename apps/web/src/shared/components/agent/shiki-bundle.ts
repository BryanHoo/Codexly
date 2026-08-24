import { createHighlighterCore, type HighlighterCoreOptions, type LanguageInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { projectLanguageModules, type HighlightLanguage } from "./code-languages.js";

export const bundledLanguages = projectLanguageModules;
export {
  codeToHtml,
  createCssVariablesTheme,
  getTokenStyleObject,
  stringifyTokenStyle,
} from "shiki/core";
export { createJavaScriptRegexEngine };

type CreateHighlighterOptions = Omit<HighlighterCoreOptions, "engine" | "langs"> &
  Readonly<{
    engine?: HighlighterCoreOptions["engine"];
    langs?: readonly (HighlightLanguage | LanguageInput | "ansi" | "text")[];
  }>;

export async function createHighlighter(options: CreateHighlighterOptions) {
  const languages: LanguageInput[] = [];
  for (const language of options.langs ?? []) {
    if (language === "ansi" || language === "text") {
      continue;
    }
    if (typeof language !== "string") {
      languages.push(language);
      continue;
    }

    const loader = bundledLanguages[language];
    languages.push((await loader()).default);
  }

  return createHighlighterCore({
    ...options,
    engine: options.engine ?? createJavaScriptRegexEngine({ forgiving: true }),
    langs: languages,
  });
}

export function createOnigurumaEngine() {
  // 应用固定使用 JavaScript Regex Engine，此兼容导出阻止依赖拉入 WASM 引擎。
  return createJavaScriptRegexEngine({ forgiving: true });
}
