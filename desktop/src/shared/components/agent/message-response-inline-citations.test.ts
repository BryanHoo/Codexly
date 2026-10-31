import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageResponse } from "./message-response.js";
import { Message } from "./message.js";

describe("桌面正文来源引用", () => {
  it.each([
    "https://github.com/ones20250/Openwrt-AX6600",
    "[项目地址](https://github.com/ones20250/Openwrt-AX6600)",
  ])("用户消息保留普通链接：%s", (source) => {
    const markup = renderToStaticMarkup(
      createElement(Message, { from: "user" },
        createElement(MessageResponse, { mode: "static", promptFileReferences: true }, source),
      ),
    );
    expect(markup).toContain('href="https://github.com/ones20250/Openwrt-AX6600"');
    expect(markup).not.toContain('data-inline-citation="true"');
  });

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
    expect(markup).not.toContain("example.com");
    expect(markup).toContain("官方文档");
  });
});
