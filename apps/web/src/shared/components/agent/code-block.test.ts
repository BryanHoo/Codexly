import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CodeBlockContent } from "./code-block.js";

describe("code viewer rendering budget", () => {
  it.each(["text", "typescript"] as const)(
    "bounds the initial DOM for 10,000 %s lines",
    (language) => {
      const code = Array.from(
        { length: 10_000 },
        (_, index) => `const value${String(index)} = ${String(index)};`,
      ).join("\n");
      const markup = renderToStaticMarkup(
        createElement(CodeBlockContent, {
          code,
          language,
          showLineNumbers: true,
        }),
      );
      const renderedLines = markup.match(/data-code-line=/gu) ?? [];

      expect(renderedLines.length).toBeGreaterThan(0);
      expect(renderedLines.length).toBeLessThan(100);
      expect(Buffer.byteLength(markup)).toBeLessThan(64 * 1_024);
    },
  );
});
