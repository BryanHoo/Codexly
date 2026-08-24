import { describe, expect, it } from "vitest";

import { highlightCode } from "./code-highlighter.js";

describe("highlightCode", () => {
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
