import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageResponse } from "./message-response.js";

describe("Web 正文来源引用", () => {
  it.each(["static", "streaming"] as const)("在 %s 模式显示来源按钮", (mode) => {
    const source = '参见 [官方 **文档**](https://www.example.com/guide "使用指南")。';
    const markup = renderToStaticMarkup(
      <MessageResponse
        mode={mode}
        {...(mode === "streaming"
          ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: true }
          : {})}
      >
        {source}
      </MessageResponse>,
    );
    expect(markup).toContain('data-inline-citation="true"');
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain("example.com");
    expect(markup).toContain("官方");
    expect(markup).not.toContain('href="https://www.example.com/guide"');
  });

  it("保留本地文件、锚点、邮件和代码语义", () => {
    const source = [
      "[main.ts](/workspace/main.ts:12)",
      "[章节](#section)",
      "[邮箱](mailto:hello@example.com)",
      "`[代码](https://example.com)`",
    ].join("\n\n");
    const markup = renderToStaticMarkup(<MessageResponse mode="static">{source}</MessageResponse>);
    expect(markup).not.toContain('data-inline-citation="true"');
    expect(markup).toContain('data-file-reference="true"');
    expect(markup).toContain('href="#section"');
    expect(markup).toContain('href="mailto:hello@example.com"');
    expect(markup).toContain("[代码](https://example.com)");
  });

  it("保留 Markdown 图片链接，不将图片隐藏到引用标签中", () => {
    const markup = renderToStaticMarkup(
      <MessageResponse mode="static" components={{ img: ({ alt }) => <img alt={alt} /> }}>
        {"[![预览](https://example.org/image.png)](https://example.com)"}
      </MessageResponse>,
    );
    expect(markup).not.toContain('data-inline-citation="true"');
    expect(markup).toContain('href="https://example.com/"');
    expect(markup).toContain('alt="预览"');
  });
});
