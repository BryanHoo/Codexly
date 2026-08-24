import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readWebFile = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const extractBrandSymbol = (source: string) => {
  const symbol = /<g id="codexly-symbol"[^>]*>([\s\S]*?)<\/g>/u.exec(source)?.[1];
  expect(symbol).toBeDefined();
  return symbol?.replace(/\s+/gu, " ").trim();
};

describe("Codexly brand assets", () => {
  it("reuses one terminal prompt symbol across the logo, mark, and favicon", () => {
    const mark = readWebFile("public/brand/codexly-mark.svg");
    const logo = readWebFile("public/brand/codexly-logo.svg");
    const favicon = readWebFile("public/favicon.svg");
    const symbols = [mark, logo, favicon].map(extractBrandSymbol);

    expect(new Set(symbols).size).toBe(1);
    expect(symbols[0]?.match(/<path\b/gu)).toHaveLength(2);
    expect(symbols[0]).not.toContain("<rect");
    expect([mark, logo, favicon].every((source) => source.includes("#339cff"))).toBe(true);
    expect(logo).toContain(">Codexly</text>");
  });

  it("uses a fresh favicon cache version", () => {
    expect(readWebFile("index.html")).toContain('href="/favicon.svg?v=4"');
  });
});
