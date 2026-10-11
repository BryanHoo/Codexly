import { CodeTokenCache } from "./code-token-cache.js";
import type { HighlightLanguage } from "./code-languages.js";
import type { TokenizedCode } from "./code-tokens.js";

const tokenCache = new CodeTokenCache();

export async function tokenizeCode(
  code: string,
  language: HighlightLanguage,
): Promise<TokenizedCode> {
  const cached = tokenCache.get(language, code);
  if (cached !== undefined) return cached;

  // 所有查看器共用字节缓存；只有需要高亮时才加载 Shiki，保持首屏轻量。
  const { highlightCode } = await import("./code-highlighter.js");
  const tokenized = await highlightCode(code, language);
  tokenCache.set(language, code, tokenized);
  return tokenized;
}
