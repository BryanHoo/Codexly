import type { ThemedToken } from "shiki/core";

import { ByteLru, estimateRetainedBytes, getUtf8ByteLength } from "../../memory/byte-lru.js";
import type { HighlightLanguage } from "./code-languages.js";

export const MAX_TOKEN_CACHE_BYTES = 24 * 1_024 * 1_024;
export const MAX_TOKEN_CACHE_ENTRIES = 128;
export const MAX_TOKEN_CACHE_SOURCE_BYTES = 512 * 1_024;

export type TokenizedCode = Readonly<{
  background: string;
  foreground: string;
  lines: ThemedToken[][];
}>;

type TokenCacheValue = Readonly<{
  source: string;
  tokenized: TokenizedCode;
}>;

function createSourceHash(source: string): string {
  let hash = 2_166_136_261;
  for (let characterIndex = 0; characterIndex < source.length; characterIndex += 1) {
    hash ^= source.charCodeAt(characterIndex);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

function createTokenCacheKey(language: HighlightLanguage, source: string): string {
  return `${language}:${String(source.length)}:${createSourceHash(source)}`;
}

export class CodeTokenCache {
  readonly #cache: ByteLru<string, TokenCacheValue>;

  public constructor(
    maxBytes = MAX_TOKEN_CACHE_BYTES,
    maxEntries = MAX_TOKEN_CACHE_ENTRIES,
    readonly maxSourceBytes = MAX_TOKEN_CACHE_SOURCE_BYTES,
  ) {
    this.#cache = new ByteLru({
      getRetainedBytes: (key, value) => getUtf8ByteLength(key) + estimateRetainedBytes(value),
      maxBytes,
      maxEntries,
    });
  }

  public get retainedBytes(): number {
    return this.#cache.retainedBytes;
  }

  public get size(): number {
    return this.#cache.size;
  }

  public get(language: HighlightLanguage, source: string): TokenizedCode | undefined {
    const cached = this.#cache.get(createTokenCacheKey(language, source));
    // 摘要键避免在 Map Key 中复制完整源码，命中时仍核验源码以防哈希碰撞。
    return cached?.source === source ? cached.tokenized : undefined;
  }

  public set(language: HighlightLanguage, source: string, tokenized: TokenizedCode): boolean {
    if (getUtf8ByteLength(source) > this.maxSourceBytes) {
      return false;
    }
    return this.#cache.set(createTokenCacheKey(language, source), { source, tokenized });
  }
}
