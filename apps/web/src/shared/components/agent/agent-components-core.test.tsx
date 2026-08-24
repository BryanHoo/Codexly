import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Conversation, ConversationContent, ConversationVirtualList } from "./conversation.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block.js";
import { Context, ContextTrigger, formatContextUsage } from "./context.js";
import { FileTree, FileTreeFile, FileTreeFolder } from "./file-tree.js";
import { Message, MessageAction, MessageContent } from "./message.js";
import { MessageResponse } from "./message-response.js";
import { Shimmer } from "./shimmer.js";
import { Task, TaskTrigger } from "./task.js";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./tool.js";
import { TooltipProvider } from "../core/tooltip.js";
import { renderWithTooltipProvider } from "./agent-components.test-support.js";

describe("agent core components", () => {
  it("使用项目组件文案命名空间", () => {
    const localeSource = readFileSync(
      new URL("../../../i18n/locales/zh-CN/conversation.ts", import.meta.url),
      "utf8",
    );

    expect(localeSource).toContain("agentComponents:");
    expect(localeSource).not.toContain("aiElements:");
  });

  it("renders an accessible file tree with folders collapsed by default", () => {
    const markup = renderToStaticMarkup(
      <FileTree aria-label="项目文件" selectedPath="README.md">
        <FileTreeFolder name="src" path="src">
          <FileTreeFile name="main.tsx" path="src/main.tsx" />
        </FileTreeFolder>
        <FileTreeFile name="README.md" path="README.md" />
      </FileTree>,
    );

    expect(markup).toContain('role="tree"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="展开文件夹 src"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain("main.tsx");
    expect(markup).toContain("README.md");

    const folderButtonClasses = [...markup.matchAll(/<button class="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(folderButtonClasses).toHaveLength(2);
    for (const classes of folderButtonClasses) {
      expect(classes).toContain("p-0");
      expect(classes).not.toContain("px-3");
      expect(classes).not.toContain("hover:bg-control-hover");
    }
    expect(folderButtonClasses[1]).not.toContain("h-8");
  });

  it("renders a code block with line numbers and a highlighted line", () => {
    const markup = renderToStaticMarkup(
      <CodeBlock
        code={"const first = 1;\nconst second = 2;"}
        highlightedLine={2}
        language="typescript"
        showLineNumbers
      >
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>example.ts</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>,
    );

    expect(markup).toContain("example.ts");
    expect(markup).toContain('data-code-line="1"');
    expect(markup).toContain('data-code-line="2"');
    expect(markup).toContain('data-highlighted="true"');
    expect(markup).toContain("const second = 2;");
    expect(markup).toContain('aria-label="复制代码"');
  });

  it("renders an accessible context usage trigger", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <Context maxTokens={200_000} usedTokens={25_000}>
          <ContextTrigger />
        </Context>
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="上下文已使用 13%"');
    expect(markup.match(/<circle/g)).toHaveLength(2);
    expect(formatContextUsage({ maxTokens: 200_000, usedTokens: 25_000 })).toEqual({
      accessibleLabel: "上下文已使用 13%",
      percentage: 13,
      summary: "13% 上下文已使用",
      tokenCount: "25K / 200K tokens",
    });
    expect(formatContextUsage({ maxTokens: undefined, usedTokens: undefined })).toEqual({
      accessibleLabel: "上下文用量未知",
      percentage: null,
      summary: "等待模型返回上下文用量",
      tokenCount: null,
    });
  });

  it("renders a structured agent message and tool timeline", () => {
    const markup = renderWithTooltipProvider(
      <Conversation aria-label="会话" conversationId="test-conversation">
        <ConversationContent>
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>完成工作台结构分析。</MessageResponse>
            </MessageContent>
          </Message>
          <Tool defaultOpen>
            <ToolHeader state="output-available" title="读取设计文档" />
            <ToolContent>docs/web-design.md</ToolContent>
          </Tool>
        </ConversationContent>
      </Conversation>,
    );

    expect(markup).toContain('role="log"');
    expect(markup).toContain("完成工作台结构分析。");
    expect(markup).toContain("已完成");
    expect(markup).toContain("bg-control");
    expect(markup).toContain("rounded-surface");
  });

  it("composes message actions with the shared tooltip", () => {
    const markup = renderWithTooltipProvider(
      <MessageAction tooltip="复制消息">复制图标</MessageAction>,
    );

    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).toContain('aria-label="复制消息"');
    expect(markup).not.toContain('title="复制消息"');
  });

  it("renders tool headers without a tooltip", () => {
    const markup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-available" title="读取完整命令" />
      </Tool>,
    );

    expect(markup).not.toContain('data-slot="tooltip-trigger"');
    expect(markup).not.toContain('title="读取完整命令"');
    expect(markup.match(/<summary/gu)).toHaveLength(1);
  });

  it("renders structured task status without a native tooltip", () => {
    const markup = renderToStaticMarkup(
      <Task status="in_progress">
        <TaskTrigger title="正在修改文件" />
      </Task>,
    );

    expect(markup).not.toContain("title=");
    expect(markup).toContain("进行中");
    expect(markup).toContain("正在修改文件");
  });

  it("only renders the visible Turn range in a long conversation", () => {
    const turns = Array.from({ length: 100 }, (_, index) => `turn-${String(index + 1)}`);
    const markup = renderToStaticMarkup(
      <Conversation aria-label="长会话" conversationId="long-conversation">
        <ConversationVirtualList
          getItemKey={(turnId) => turnId}
          items={turns}
          renderItem={(turnId, turnIndex) => (
            <section aria-label={`Turn ${String(turnIndex + 1)}`}>{turnId}</section>
          )}
        />
      </Conversation>,
    );

    expect(markup).toContain("turn-1");
    expect(markup).not.toContain("turn-100");
    expect(markup.match(/aria-label="Turn /g)?.length).toBeLessThan(turns.length);
  });

  it("renders a polymorphic running Shimmer with an accessible status", () => {
    const markup = renderToStaticMarkup(
      <Shimmer aria-label="AI 回复正在运行" as="span" role="status">
        正在运行
      </Shimmer>,
    );

    expect(markup).toContain('<span class="agent-shimmer inline-block ');
    expect(markup).toContain('data-agent-shimmer=""');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("正在运行");
  });

  it("renders localized tool states with structured JSON input and output", () => {
    const markup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-available" title="读取文件" />
        <ToolContent>
          <ToolInput input={{ path: "src/index.ts", range: [1, 20] }} />
          <ToolOutput errorText={undefined} output={{ lines: 20, truncated: false }} />
        </ToolContent>
      </Tool>,
    );

    expect(markup).toContain("读取文件");
    expect(markup).toContain("已完成");
    expect(markup).toContain(">参数<");
    expect(markup).toContain(">结果<");
    expect(markup).toContain("&quot;path&quot;: &quot;src/index.ts&quot;");
    expect(markup).toContain("&quot;lines&quot;: 20");
    expect(markup).toContain('data-language="json"');
  });

  it("does not render tool details until the tool is opened", () => {
    const collapsedMarkup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-available" title="读取大型结果" />
        <ToolContent>仅展开后渲染的大型内容</ToolContent>
      </Tool>,
    );
    const expandedMarkup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-available" title="读取大型结果" />
        <ToolContent>仅展开后渲染的大型内容</ToolContent>
      </Tool>,
    );

    expect(collapsedMarkup).toContain("读取大型结果");
    expect(collapsedMarkup).not.toContain("仅展开后渲染的大型内容");
    expect(expandedMarkup).toContain("仅展开后渲染的大型内容");
  });

  it("renders denied and failed tools as distinct error states", () => {
    const deniedMarkup = renderWithTooltipProvider(
      <Tool>
        <ToolHeader state="output-denied" title="执行命令" />
      </Tool>,
    );
    const failedMarkup = renderWithTooltipProvider(
      <Tool defaultOpen>
        <ToolHeader state="output-error" title="读取文件" />
        <ToolContent>
          <ToolOutput errorText="文件不存在" output={undefined} />
        </ToolContent>
      </Tool>,
    );

    expect(deniedMarkup).toContain("已拒绝");
    expect(failedMarkup).toContain("失败");
    expect(failedMarkup).toContain(">错误<");
    expect(failedMarkup).toContain("文件不存在");
  });
});
