import { describe, expect, it, vi } from "vitest";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

import { highlightCode } from "./code-highlighter.js";

describe("highlightCode", () => {
  it.each(["\n", "\r\n"])(
    "preserves multiline grammar, empty lines and source offsets with %j",
    async (newline) => {
      const code = [
        ...Array.from(
          { length: 29 },
          (_, index) => `const value${String(index)} = ${String(index)};`,
        ),
        "/*",
        ...Array.from({ length: 40 }, () => "const thisIsAComment = true;"),
        "*/",
        "const template = `",
        ...Array.from({ length: 40 }, () => "template text"),
        "`;",
        "",
        "const after = true;",
        "",
      ].join(newline);
      const reference = await createHighlighterCore({
        engine: createJavaScriptRegexEngine({ forgiving: true }),
        langs: [typescript],
        themes: [githubLight, githubDark],
      });
      try {
        const expected = reference.codeToTokens(code, {
          lang: "typescript",
          themes: { dark: "github-dark", light: "github-light" },
        });
        expect((await highlightCode(code, "typescript")).lines).toEqual(expected.tokens);
      } finally {
        reference.dispose();
      }
    },
  );

  it("yields to pending interaction tasks while highlighting many small lines", async () => {
    // 先预热语法，确保计时器由分批高亮让出的执行机会触发，而非首次动态导入。
    await highlightCode("const warmup = true;", "typescript");
    const interaction = vi.fn();
    const timer = setTimeout(interaction, 0);
    try {
      await highlightCode("const enabled = true;\n".repeat(1_000), "typescript");
      expect(interaction).toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
    }
  });

  it("falls back to plain text for UTF-8 sources above 128 KiB", async () => {
    const code = "中".repeat(44_000);
    const highlighted = await highlightCode(code, "typescript");
    expect(highlighted.lines).toEqual([[{ content: code, offset: 0 }]]);
  });
  it.each([
    ["json", '{"enabled":true}'],
    ["typescript", "const enabled: boolean = true;"],
  ] as const)("loads the explicit %s grammar with both themes", async (language, code) => {
    const highlighted = await highlightCode(code, language);
    const tokens = highlighted.lines.flat();

    expect(tokens.map((token) => token.content).join("")).toBe(code);
    expect(
      tokens.some(
        (token) => Object.hasOwn(token, "color") || Object.hasOwn(token.htmlStyle ?? {}, "color"),
      ),
    ).toBe(true);
    expect(tokens.some((token) => token.htmlStyle?.["--shiki-dark"] !== undefined)).toBe(true);
  });
});
