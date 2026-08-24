import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Message, MessageContent } from "./message.js";
import { MessageResponse } from "./message-response.js";
import {
  renderWithTooltipProvider,
  resolveStreamdownMermaidVersion,
  resolveStreamdownDompurifyVersion,
} from "./agent-components.test-support.js";

describe("agent Markdown components", () => {
  it("renders assistant Markdown as semantic HTML", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{"## 结果\n\n- 支持 **Markdown**\n- 支持 `code`"}</MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toMatch(/<h2[^>]*>结果<\/h2>/);
    expect(markup).toContain('data-streamdown="unordered-list"');
    expect(markup).toContain('data-streamdown="strong">Markdown</span>');
    expect(markup).toContain('data-streamdown="inline-code">code</code>');
    expect(markup).not.toContain("## 结果");
  });

  it("renders unfenced SVG markup as visible XML source", () => {
    const svgSource = `<svg viewBox="0 0 24 24">
  <path d="M1 1h22v22H1z" />
</svg>`;
    const markup = renderToStaticMarkup(
      <MessageResponse>{`前文\n\n${svgSource}\n\n后文`}</MessageResponse>,
    );

    expect(markup).toContain("前文");
    expect(markup).toContain("后文");
    expect(markup).toContain('data-language="xml"');
    expect(markup).toContain("&lt;svg viewBox=&quot;0 0 24 24&quot;&gt;");
    expect(markup).toContain("&lt;path d=&quot;M1 1h22v22H1z&quot; /&gt;");
    expect(markup).not.toContain('<svg viewBox="0 0 24 24">');
  });

  it("uses the patched Mermaid release for untrusted Agent Markdown", () => {
    expect(resolveStreamdownMermaidVersion()).toBe("11.16.1");
  });

  it("uses the patched DOMPurify release for untrusted Agent Markdown", () => {
    expect(resolveStreamdownDompurifyVersion()).toBe("3.4.13");
  });

  it.each([
    [
      "CSS sibling injection",
      `---
config:
  themeCSS: |-
    & + * { background:red !important; position:fixed !important; inset:0 !important; }
---
info`,
    ],
    [
      "architecture prototype pollution",
      `architecture-beta
  group mermaidPrototypePollutionMarker(cloud)[Marker]
  service a(server)[A] in __proto__
  service b(server)[B] in mermaidPrototypePollutionMarker
  a:R -- L:b`,
    ],
    [
      "XY chart infinite loop",
      `xychart
  x-axis 1 --> 1
  line [1, 2]`,
    ],
    [
      "radar chart resource exhaustion",
      `radar-beta
  axis a, b
  curve c {1, 1}
  ticks 1000000000`,
    ],
  ])("keeps malicious Mermaid input inert: %s", (_name, diagram) => {
    const markup = renderToStaticMarkup(
      <MessageResponse>{`\`\`\`mermaid\n${diagram}\n\`\`\``}</MessageResponse>,
    );

    // Agent 产出的 Mermaid 未配置受信任插件时只能作为代码显示，不能进入图表执行路径。
    expect(markup).toContain('data-streamdown="code-block"');
    expect(markup).toContain('data-language="mermaid"');
    expect(markup).not.toContain('data-streamdown="mermaid-block"');
    expect(markup).not.toContain("<style");
  });

  it("opens safe external links in a new tab and rejects dangerous protocols", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>
            {"[OpenAI](https://openai.com)\n\n[unsafe](javascript:alert('x'))"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('href="https://openai.com/"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('href="javascript:');
  });

  it("renders Markdown file references with the project brand treatment", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>
            {
              "- 修复并发冲突。[agent-provider.ts](/workspace/packages/agent-provider.ts:948)\n- 更新规范。[runtime-lifecycle.md](/workspace/.superwork/runtime-lifecycle.md:16)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-file-reference="true"');
    expect(markup).not.toContain("data-file-extension");
    expect(markup).toContain("text-brand");
    expect(markup).toContain("agent-provider.ts");
    expect(markup).toContain("(line 948)");
  });

  it("renders prompt file references with the composer token treatment", () => {
    const markup = renderWithTooltipProvider(
      <Message from="user">
        <MessageContent>
          <MessageResponse promptFileReferences onOpenFileReference={() => undefined}>
            {"请检查 @src/main.tsx，保留 `@src/raw.ts`。"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-prompt-file-reference="src/main.tsx"');
    expect(markup).toContain('title="src/main.tsx"');
    expect(markup).toContain("main.tsx");
    expect(markup).toContain("@src/raw.ts");
    expect(markup.match(/data-prompt-file-reference=/gu)).toHaveLength(1);
  });

  it("renders local Markdown file references as source preview buttons when enabled", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[architecture-design.md](/workspace/docs/architecture-design.md:716)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain("hover:decoration-current");
    expect(markup).toContain('data-file-reference="true"');
    expect(markup).toContain("architecture-design.md");
    expect(markup).toContain("(line 716)");
    expect(markup).not.toContain('href="/workspace/docs/architecture-design.md:716"');
  });

  it("decodes URL-encoded UTF-8 local file references before preview", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[后续工作交接.pptx](/home/taoye/%E4%B8%8B%E8%BD%BD/AI%E9%A2%86%E8%88%AA%C2%B7%E6%99%BA%E8%A7%81%E6%9C%AA%E6%9D%A5/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/下载/AI领航·智见未来/后续工作交接.pptx"');
    expect(markup).not.toContain("%E4%B8%8B%E8%BD%BD");
  });

  it("renders local file references containing unencoded spaces", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[后续工作交接.pptx](/home/taoye/下载/AI 领航/后续 工作交接.pptx)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/下载/AI 领航/后续 工作交接.pptx"');
    expect(markup).toContain('data-file-reference="true"');
  });

  it("decodes UTF-8 byte runs without rewriting literal percent signs", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[后续工作交接.pptx](/home/taoye/100%完成/%E5%90%8E%E7%BB%AD%E5%B7%A5%E4%BD%9C%E4%BA%A4%E6%8E%A5.pptx)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('title="/home/taoye/100%完成/后续工作交接.pptx"');
    expect(markup).not.toContain("%E5%90%8E%E7%BB%AD");
  });

  it("renders Windows Markdown file references as source preview buttons", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {
              "[app.ts](C:/workspace/Codexly/src/app.ts:12)\n\n[server.ts](C:\\workspace\\Codexly\\src\\server.ts:24)\n\n[share.ts](\\\\server\\share\\share.ts:3)"
            }
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('data-file-reference="true"');
    expect(markup).toContain("(line 12)");
    expect(markup).toContain("(line 24)");
    expect(markup).toContain("(line 3)");
    expect(markup.match(/data-file-reference="true"/g)).toHaveLength(3);
    expect(markup).toContain('title="C:/workspace/Codexly/src/app.ts"');
    expect(markup).toContain('title="C:/workspace/Codexly/src/server.ts"');
    expect(markup).toContain('title="//server/share/share.ts"');
    expect(markup).not.toContain('href="C:/workspace/Codexly/src/app.ts:12"');
  });

  it("renders relative Markdown file references as preview buttons", () => {
    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse onOpenFileReference={() => undefined}>
            {"[guide.md](docs/guide.md:8)"}
          </MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain("(line 8)");
    expect(markup).toContain('title="docs/guide.md"');
  });

  it("extracts code review directives into a dedicated comments summary", () => {
    const reviewMarkdown = `发现 3 个需要修复的问题：

1. **[P1] 第一个问题**

::code-comment{title="[P1] 不要复用冲突的审批决策" body="冲突决策不能共享结果。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=939 end=941 priority=1}

2. **[P1] 第二个问题**

::code-comment{title="[P1] 落实 autoResolutionMs 的到期行为" body="请求到期后必须进入终态。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=261 end=267 priority=1}

3. **[P2] 第三个问题**

::code-comment{title="[P2] 同时清理读取期间暂存的请求" body="终态时同步清理请求。" file="/workspace/packages/provider-codex/src/agent-provider.ts" start=980 end=985 priority=2}`;

    const markup = renderToStaticMarkup(
      <Message from="assistant">
        <MessageContent>
          <MessageResponse>{reviewMarkdown}</MessageResponse>
        </MessageContent>
      </Message>,
    );

    expect(markup).toContain('data-code-comments="true"');
    expect(markup).toContain('class="my-4 overflow-hidden');
    expect(markup).toContain("3 个代码评论");
    expect(markup).toContain("不要复用冲突的审批决策");
    expect(markup).toContain("packages/provider-codex/src/agent-provider.ts:939-941");
    expect(markup).toContain(">P1</span>");
    expect(markup).toContain(">P2</span>");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).not.toContain("::code-comment");
    expect(markup).not.toContain(">冲突决策不能共享结果。<");
  });
});
