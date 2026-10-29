import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageResponse } from "./message-response.js";

describe("桌面正文来源引用", () => {
  it.each(["static", "streaming"] as const)("在 %s 模式复用共享来源按钮", (mode) => {
    const source = "参见 [官方文档](https://www.example.com/guide)。";
    const markup = renderToStaticMarkup(
      createElement(MessageResponse, {
        mode,
        ...(mode === "streaming"
          ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: true }
          : {}),
      }, source),
    );
    expect(markup).toContain('data-inline-citation="true"');
    expect(markup).toContain("example.com");
    expect(markup).toContain("官方文档");
  });
});
