import { describe, expect, it } from "vitest";

import {
  CODE_HIGHLIGHT_MAX_BYTES,
  createCodePageLayout,
  createCodePageTokenStore,
  createRawTokens,
  getCodePageLineTokens,
  shouldHighlightCode,
} from "./code-block-pages.js";

describe("shared code viewer pages", () => {
  it("measures UTF-8 bytes instead of UTF-16 characters", () => {
    expect(shouldHighlightCode("typescript", "中".repeat(43_690))).toBe(true);
    expect(shouldHighlightCode("typescript", "中".repeat(43_691))).toBe(false);
    expect(shouldHighlightCode("typescript", "a".repeat(CODE_HIGHLIGHT_MAX_BYTES))).toBe(true);
    expect(shouldHighlightCode("text", "a")).toBe(false);
  });

  it("invalidates in-flight tokens when appended pages exceed the aggregate budget", () => {
    const store = createCodePageTokenStore();
    const firstPage = { code: "a".repeat(80 * 1_024), key: "first" };
    const first = store.reconcile([firstPage], "typescript");
    const firstState = first[0];
    if (firstState === undefined) throw new Error("Expected the first page token state");
    firstState.status = "loading";
    const expanded = store.reconcile(
      [firstPage, { code: "b".repeat(80 * 1_024), key: "second" }],
      "typescript",
    );
    expect(store.isCurrent(firstState)).toBe(false);
    expect(
      expanded.every((state) => state.status === "complete" && state.tokenized === state.rawTokens),
    ).toBe(true);
    expect(expanded[0]?.rawTokens).toBe(firstState.rawTokens);
    expect(store.reconcile([firstPage], "typescript")[0]?.status).toBe("idle");
  });

  it("merges fragmented lines and retains empty and trailing lines", () => {
    const layout = createCodePageLayout([
      createRawTokens("first\npart"),
      createRawTokens(""),
      createRawTokens("ial\n\nlast\n"),
    ]);
    expect(layout.lineCount).toBe(5);
    expect(
      Array.from({ length: layout.lineCount }, (_, index) =>
        getCodePageLineTokens(layout, index)
          .map((token) => token.content)
          .join(""),
      ),
    ).toEqual(["first", "partial", "", "last", ""]);
    expect(getCodePageLineTokens(layout, 10_000)).toEqual([]);
  });
});
