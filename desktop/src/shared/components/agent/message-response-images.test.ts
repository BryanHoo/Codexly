import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";

describe("桌面聊天生成图片", () => {
  it("缺少任务文件上下文时显示本地化失败提示", () => {
    const markup = renderToStaticMarkup(createElement(MessageResponse, { mode: "static" }, "![本地预览](./missing.png)"));
    expect(markup).toContain("附件读取失败：本地预览");
    expect(markup).not.toContain("/__codeagent_relative__/");
  });
  it.each(["static", "streaming"] as const)("在 %s 回复中还原真实任务图片路径", (mode) => {
    const source = "![新旧图标对比](./outputs/icon-designs/comparison.png)";
    const resolveImage = vi.fn(() => "asset://localhost/cached-comparison.png");
    const markup = renderToStaticMarkup(createElement(MessageResponse, {
      mode, resolveImage,
      ...(mode === "streaming" ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: false } : {}),
    }, source));
    expect(resolveImage).toHaveBeenCalledWith("outputs/icon-designs/comparison.png");
    expect(markup).toContain('src="asset://localhost/cached-comparison.png"');
    expect(markup).not.toContain("/__codeagent_relative__/");
  });
});
