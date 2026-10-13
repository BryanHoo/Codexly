import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";

const path = "D:/wuliangye/正式汇报/业主交流版/项目进度汇报_业主交流修订版.pptx";
const citation = `:codex-file-citation{path="${path}" artifact-kind="presentation" purpose="output"}`;

describe("Web 文件引用", () => {
  it.each(["static", "streaming"] as const)(
    "在 %s 回复中将 PPTX 引用显示为可点击文件卡片",
    (mode) => {
      const source = `已另存修订版。\n\n${citation}`;
      const markup = renderToStaticMarkup(
        createElement(
          MessageResponse,
          {
            mode,
            onOpenFileReference: vi.fn(),
            ...(mode === "streaming"
              ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: false }
              : {}),
          },
          source,
        ),
      );
      expect(markup).toContain('data-file-citation="true"');
      expect(markup).toContain('type="button"');
      expect(markup).toContain("项目进度汇报_业主交流修订版.pptx");
      expect(markup).not.toContain(":codex-file-citation");
      expect(markup).not.toContain("artifact-kind");
    },
  );

  it("保留行内代码、代码块和已有链接里的引用示例", () => {
    for (const source of [
      `\`${citation}\``,
      `\`\`\`text\n${citation}\n\`\`\``,
      `[${citation}](https://example.com)`,
    ]) {
      const markup = renderToStaticMarkup(
        createElement(MessageResponse, { mode: "static" }, source),
      );
      expect(markup).not.toContain('data-file-citation="true"');
      expect(markup).toContain(":codex-file-citation");
    }
  });

  it("兼容 Windows 反斜杠及路径中的 Markdown 字符", () => {
    const filePath = String.raw`C:\报告\final [v2]_a*b#100%.pptx`;
    const source = `前文 :codex-file-citation{artifact_kind=presentation path="${filePath}" purpose=output} 后文`;
    const markup = renderToStaticMarkup(
      createElement(MessageResponse, { mode: "static", onOpenFileReference: vi.fn() }, source),
    );
    expect(markup).toContain('data-file-citation="true"');
    expect(markup).toContain("final [v2]_a*b#100%.pptx");
    expect(markup).toContain("前文");
    expect(markup).toContain("后文");
  });
});
