import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

import { projectLanguageModules, type HighlightLanguage } from "./code-languages.js";
import type { TokenizedCode } from "./code-tokens.js";
import { createRawTokens, shouldHighlightCode } from "./code-block-pages.js";

export type { HighlightLanguage } from "./code-languages.js";

const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine({ forgiving: true }),
  langs: [],
  themes: [githubLight, githubDark],
});
const languagePromises = new Map<HighlightLanguage, Promise<HighlighterCore>>();
const HIGHLIGHT_BATCH_LINES = 32;
const HIGHLIGHT_BATCH_CHARACTERS = 4_096;
const HIGHLIGHT_MAX_LINE_LENGTH = 2_048;

async function yieldToInteraction(): Promise<void> {
  // Promise.resolve() 只让出微任务，无法处理触摸和输入；定时器兼容旧 WebKit。
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

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
  // 在加载语法和运行正则前拒绝超限输入，移动端也只保留完整纯文本。
  if (!shouldHighlightCode(language, code)) return createRawTokens(code);
  const highlighter = await getHighlighter(language);
  const sourceLines = code.split("\n");
  const lines: ThemedToken[][] = [];
  let grammarState: GrammarState | undefined;
  let offset = 0;
  let background = "transparent";
  let foreground = "inherit";

  for (let start = 0; start < sourceLines.length;) {
    // 行数与字符数双重限制批次，避免大量短行或压缩后的超长行占用整帧。
    let end = start;
    let characters = 0;
    while (end < sourceLines.length && end - start < HIGHLIGHT_BATCH_LINES) {
      const nextLength = (sourceLines[end]?.length ?? 0) + 1;
      if (end > start && characters + nextLength > HIGHLIGHT_BATCH_CHARACTERS) break;
      characters += nextLength;
      end += 1;
    }
    await yieldToInteraction();
    const batchSource = sourceLines.slice(start, end).join("\n");
    // CRLF 的 CR 不能作为批次末行正文交给语法；完整源码偏移仍计入它。
    const batch =
      end < sourceLines.length && batchSource.endsWith("\r")
        ? batchSource.slice(0, -1)
        : batchSource;
    const result = highlighter.codeToTokens(batch, {
      lang: language,
      themes: { dark: "github-dark", light: "github-light" },
      ...(grammarState === undefined ? {} : { grammarState }),
      tokenizeMaxLineLength: HIGHLIGHT_MAX_LINE_LENGTH,
    });
    // 传递双主题语法状态以保留跨批次注释、字符串；偏移仍指向完整源码。
    grammarState = result.grammarState;
    for (const tokens of result.tokens) {
      for (const token of tokens) token.offset += offset;
      lines.push(tokens);
    }
    background = result.bg ?? background;
    foreground = result.fg ?? foreground;
    offset += batchSource.length + 1;
    start = end;
  }

  return {
    background,
    foreground,
    lines,
  };
}
