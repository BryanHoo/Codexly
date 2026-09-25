import type { Key } from "react";
import type { ThemedToken } from "shiki/core";

import { getUtf8ByteLength } from "../../memory/byte-lru.js";
import type { CodeBlockLanguage } from "./code-languages.js";
import type { TokenizedCode } from "./code-token-cache.js";

export const CODE_HIGHLIGHT_MAX_BYTES = 128 * 1_024;

export type CodeBlockPage = Readonly<{
  code: string;
  key: Key;
}>;

export type CodePageTokenState = {
  readonly code: string;
  readonly highlightingEnabled: boolean;
  readonly key: Key;
  readonly language: CodeBlockLanguage;
  readonly rawTokens: TokenizedCode;
  readonly sourceBytes: number;
  status: "complete" | "idle" | "loading";
  tokenized: TokenizedCode;
};

export type CodePageLayout = Readonly<{
  entries: readonly Readonly<{
    endLine: number;
    startLine: number;
    tokenized: TokenizedCode;
  }>[];
  lineCount: number;
}>;

export function createRawTokens(code: string): TokenizedCode {
  return {
    background: "transparent",
    foreground: "inherit",
    lines: code.split("\n").map((line) => (line === "" ? [] : [{ content: line, offset: 0 }])),
  };
}

export function shouldHighlightCode(language: CodeBlockLanguage, code: string): boolean {
  return language !== "text" && getUtf8ByteLength(code) <= CODE_HIGHLIGHT_MAX_BYTES;
}

export function createCodePageTokenStore(): {
  isCurrent: (state: CodePageTokenState) => boolean;
  reconcile: (
    pages: readonly CodeBlockPage[],
    language: CodeBlockLanguage,
  ) => readonly CodePageTokenState[];
} {
  let states = new Map<Key, CodePageTokenState>();

  return {
    isCurrent: (state) => states.get(state.key) === state,
    reconcile: (pages, language) => {
      const nextStates = new Map<Key, CodePageTokenState>();
      const candidates = pages.map((page) => {
        const existing = states.get(page.key);
        const canReuseSource =
          existing !== undefined &&
          existing.code === page.code &&
          existing.language === language;
        return {
          existing: canReuseSource ? existing : undefined,
          page,
          rawTokens: canReuseSource ? existing.rawTokens : createRawTokens(page.code),
          sourceBytes: canReuseSource ? existing.sourceBytes : getUtf8ByteLength(page.code),
        };
      });
      const highlightingEnabled =
        language !== "text" &&
        candidates.reduce((total, candidate) => total + candidate.sourceBytes, 0) <=
          CODE_HIGHLIGHT_MAX_BYTES;
      const orderedStates = candidates.map(({ existing, page, rawTokens, sourceBytes }) => {
        if (existing?.highlightingEnabled === highlightingEnabled) {
          nextStates.set(page.key, existing);
          return existing;
        }
        const state: CodePageTokenState = {
          code: page.code,
          highlightingEnabled,
          key: page.key,
          language,
          rawTokens,
          sourceBytes,
          status: highlightingEnabled ? "idle" : "complete",
          tokenized: rawTokens,
        };
        nextStates.set(page.key, state);
        return state;
      });
      states = nextStates;
      return orderedStates;
    },
  };
}

export function createCodePageLayout(pages: readonly TokenizedCode[]): CodePageLayout {
  let startLine = 0;
  const entries = pages.map((tokenized) => {
    const endLine = startLine + tokenized.lines.length - 1;
    const entry = { endLine, startLine, tokenized };
    // 相邻页的边界片段属于同一逻辑行，因此下一页从当前末行继续。
    startLine = endLine;
    return entry;
  });

  return {
    entries,
    lineCount: entries.length === 0 ? 0 : startLine + 1,
  };
}

export function getCodePageLineTokens(
  layout: CodePageLayout,
  lineIndex: number,
): ThemedToken[] {
  let low = 0;
  let high = layout.entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const entry = layout.entries[middle];
    if (entry !== undefined && entry.endLine < lineIndex) low = middle + 1;
    else high = middle;
  }

  const tokens: ThemedToken[] = [];
  for (let entryIndex = low; entryIndex < layout.entries.length; entryIndex += 1) {
    const entry = layout.entries[entryIndex];
    if (entry === undefined || entry.startLine > lineIndex) break;
    const pageTokens = entry.tokenized.lines[lineIndex - entry.startLine];
    if (pageTokens !== undefined) tokens.push(...pageTokens);
  }
  return tokens;
}
