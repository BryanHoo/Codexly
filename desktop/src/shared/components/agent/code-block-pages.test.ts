import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeBlockContent } from "./code-block.js";
import {
  CODE_HIGHLIGHT_MAX_BYTES,
  createCodePageLayout,
  createCodePageTokenStore,
  createRawTokens,
  getCodePageLineTokens,
  shouldHighlightCode,
} from "./code-block-pages.js";

describe("code block pages", () => {
  it("merges tokens from a line split across page boundaries", () => {
    const layout = createCodePageLayout([
      createRawTokens("const value ="),
      createRawTokens(" 1;\nreturn value;\n"),
    ]);

    expect(layout.lineCount).toBe(3);
    expect(getCodePageLineTokens(layout, 0).map((token) => token.content).join(""))
      .toBe("const value = 1;");
    expect(getCodePageLineTokens(layout, 1).map((token) => token.content).join(""))
      .toBe("return value;");
    expect(getCodePageLineTokens(layout, 2)).toEqual([]);
  });

  it("reuses token state for unchanged pages when a page is appended", () => {
    const store = createCodePageTokenStore();
    const first = store.reconcile([{ code: "first\n", key: "page-1" }], "typescript");
    const second = store.reconcile(
      [
        { code: "first\n", key: "page-1" },
        { code: "second\n", key: "page-2" },
      ],
      "typescript",
    );

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[0]);
  });

  it("disables syntax highlighting above the source byte limit", () => {
    expect(shouldHighlightCode("typescript", "a".repeat(CODE_HIGHLIGHT_MAX_BYTES))).toBe(true);
    expect(shouldHighlightCode("typescript", "a".repeat(CODE_HIGHLIGHT_MAX_BYTES + 1))).toBe(
      false,
    );
    expect(shouldHighlightCode("text", "const value = 1;")).toBe(false);
  });

  it("applies the highlight limit to the complete paginated source", () => {
    const store = createCodePageTokenStore();
    const states = store.reconcile(
      [
        { code: "a".repeat(80 * 1_024), key: "page-1" },
        { code: "b".repeat(80 * 1_024), key: "page-2" },
      ],
      "typescript",
    );

    expect(states.map((state) => state.status)).toEqual(["complete", "complete"]);
  });

  it("renders only the virtual viewport for a large source", () => {
    const code = Array.from({ length: 10_000 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const markup = renderToStaticMarkup(
      createElement(CodeBlockContent, {
        language: "text",
        pages: [{ code, key: "large-source" }],
        showLineNumbers: true,
      }),
    );
    const renderedLines = markup.match(/data-code-line=/gu) ?? [];

    expect(renderedLines.length).toBeGreaterThan(0);
    expect(renderedLines.length).toBeLessThan(100);
  });
});
