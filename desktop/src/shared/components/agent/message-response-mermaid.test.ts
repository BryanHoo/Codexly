import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";

describe("桌面 Mermaid 渲染入口", () => {
  it.each(["static", "streaming"] as const)("%s 消息使用图表插件", (mode) => {
    const source = "```mermaid\nflowchart LR\nA[AI 修改] --> C[文档命令与校验]\n```";
    for (const snapshot of [false, true]) {
      const markup = renderToStaticMarkup(
        snapshot
          ? createElement(MessageResponse, {
              mode,
              textSource: new AppendOnlyTextBuffer(source).getSnapshot(),
            })
          : createElement(MessageResponse, { mode }, source),
      );
      expect(markup).toMatch(/animate-spin|data-streamdown="mermaid-block"/u);
      expect(markup).not.toContain('data-language="mermaid"');
    }
  });

  it("未闭合的流式图表也交给插件处理", () => {
    const buffer = new AppendOnlyTextBuffer("```mermaid\nflowchart LR\nA --> B");
    const markup = renderToStaticMarkup(
      createElement(MessageResponse, { mode: "streaming", textSource: buffer.getSnapshot() }),
    );
    expect(markup).toMatch(/animate-spin|data-streamdown="mermaid-block"/u);
    expect(markup).not.toContain("data-streaming-code-line");
  });
});
