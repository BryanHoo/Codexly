import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppendOnlyTextBuffer } from "@codexly/frontend-core/append-only-text";
import { MessageResponse } from "./message-response.js";
import {
  IncrementalMessageResponseProcessor,
  preprocessMessageResponse,
} from "./message-response-processing.js";
import { MessageFollowupProvider } from "@codexly/ui/core/message-assistant-directive";
import { parseCodeCommentDirective } from "./code-comments.js";

function markup(source: string, streaming = false) {
  return renderToStaticMarkup(
    createElement(
      MessageResponse,
      {
        mode: streaming ? "streaming" : "static",
        ...(streaming
          ? { textSource: new AppendOnlyTextBuffer(source).getSnapshot(), isAnimating: false }
          : {}),
        onOpenFileReference: () => undefined,
      },
      source,
    ),
  );
}

describe("Codex 特殊标记", () => {
  it.each([false, true])("识别后续建议并隐藏内部 prompt，流式=%s", (streaming) => {
    const html = markup(':codex-followup[添加 **图表**]{prompt="请为本季度添加图表"}', streaming);
    expect(html).toContain('data-codex-followup="true"');
    expect(html).toContain("添加");
    expect(html).toContain("图表");
    expect(html).not.toContain(":codex-followup");
    expect(html).not.toContain("prompt=");
    expect(html).not.toContain("请为本季度添加图表");
  });

  it("识别全部 Git 回执并保留分支信息", () => {
    const html = markup(
      '已完成。\n\n::git-stage{cwd="/repo"} ::git-commit{cwd="/repo"} ::git-create-branch{cwd="/repo" branch="feature/report"} ::git-push{cwd="/repo" branch="feature/report"} ::git-create-pr{cwd="/repo" branch="feature/report" url="https://example.com/pr/1" isDraft=true}',
    );
    expect(html.match(/data-codex-git-receipt=/gu)).toHaveLength(5);
    expect(html).toContain("feature/report");
    expect(html).not.toContain("::git-");
    expect(html).toContain('href="https://example.com/pr/1"');
  });

  it.each(['::codex-inline-vis{file="/tmp/图表.html"}', 'visualize{"path":"/tmp/图表.html"}'])(
    "将可视化标记转为文件入口：%s",
    (source) => {
      const html = markup(source);
      expect(html).toContain('data-file-citation="true"');
      expect(html).toContain("图表.html");
      expect(html).not.toContain("codex-inline-vis");
      expect(html).not.toContain("");
    },
  );

  it("隐藏实时正文标记并保留后续 Markdown", () => {
    const html = markup("::codex-realtime-inline{}\n\n## 实时结果");
    expect(html).not.toContain("codex-realtime-inline");
    expect(html).toContain("实时结果");
    expect(html).toMatch(/<h2/u);
  });

  it("代码示例及已有链接中的特殊标记保持原文", () => {
    const directive = ":codex-followup[继续]{prompt=continue}";
    for (const source of [
      `\`${directive}\``,
      `\`\`\`text\n${directive}\n::git-stage{cwd=/repo}\n\`\`\``,
      `[${directive}](https://example.com)`,
    ]) {
      const html = markup(source);
      expect(html).not.toContain('data-codex-followup="true"');
      expect(html).not.toContain("data-codex-git-receipt=");
      expect(html).toContain(":codex-followup");
    }
  });

  it("不会识别隐藏 prompt 中嵌套的文件引用", () => {
    const html = markup(
      ':codex-followup[继续]{prompt="请使用 :codex-file-citation{path=secret.pptx}"}',
    );
    expect(html).toContain('data-codex-followup="true"');
    expect(html).not.toContain('data-file-citation="true"');
    expect(html).not.toContain("secret.pptx");
  });

  it("审查评论兼容官方的空格、单引号、三冒号与优先级写法", () => {
    const comment = parseCodeCommentDirective(
      "  :::code-comment{title = '修复竞态' body='请求可能迟到。' file='src/main.ts' start=8 end=2 priority=P1}",
    );
    expect(comment).toMatchObject({
      title: "修复竞态",
      body: "请求可能迟到。",
      file: "src/main.ts",
      start: 8,
      end: 8,
      priority: 1,
    });
  });

  it("同一行的审查评论和 Git 回执都能显示", () => {
    const html = markup(
      '::code-comment{title="修复竞态" body="请求可能迟到。" file="src/main.ts" start=8} ::git-stage{cwd="/repo"}',
    );
    expect(html).toContain('data-code-comments="true"');
    expect(html).toContain('data-codex-git-receipt="git-stage"');
    expect(html).not.toContain("::code-comment");
  });
  it("只在当前聊天提供点选建议入口，只读消息只展示标签", () => {
    const source = ':codex-followup[继续制作]{prompt="继续制作报告"}';
    const html = renderToStaticMarkup(
      createElement(
        MessageFollowupProvider,
        { onSelect: () => undefined },
        createElement(MessageResponse, { mode: "static" }, source),
      ),
    );
    expect(html).toContain('data-codex-followup="true"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain("继续制作报告");
    expect(markup(source)).not.toContain('type="button"');
  });

  it.each(["```", "~~~~"])(
    "评论代码示例在 %s 围栏中不会被抽取，逐字流式结果与静态一致",
    (fence) => {
      const comment = ':::code-comment{title="示例" body="不要执行。" file="src/main.ts"}';
      const source = `${fence}text\n${comment}\n${fence}\n\n${comment}`;
      const expected = preprocessMessageResponse(source);
      expect(expected.comments).toHaveLength(1);
      expect(expected.markdown).toContain(comment);
      const buffer = new AppendOnlyTextBuffer("");
      const processor = new IncrementalMessageResponseProcessor();
      let result = processor.process(buffer.getSnapshot());
      for (const character of source) {
        buffer.append(character);
        result = processor.process(buffer.getSnapshot());
      }
      expect(result.comments).toEqual(expected.comments);
      expect(result.markdown).toBe(expected.markdown);
    },
  );
  it.each([
    "Inspect [nested [labels]]",
    "Inspect `items[0]`",
    "Type a ` character",
    "Inspect [link](https://example.com)",
  ])("建议标签保留内联文字：%s", (label) => {
    const html = markup(`:codex-followup[${label}]{prompt=continue}`);
    expect(html).toContain('data-codex-followup="true"');
    expect(html).not.toContain("/__codexly_followup__/");
    expect(html).not.toContain("codex-followup[");
  });
  it("隐藏属性中的 Markdown 保持字面内容", () => {
    const source = ':codex-followup[继续]{prompt="请保留 **原文。**继续"}';
    expect(preprocessMessageResponse(source).markdown).toBe(source);
    const buffer = new AppendOnlyTextBuffer("");
    const processor = new IncrementalMessageResponseProcessor();
    for (const character of source) {
      buffer.append(character);
      processor.process(buffer.getSnapshot());
    }
    expect(processor.process(buffer.getSnapshot()).markdown).toBe(source);
    const path = ':codex-file-citation{path="/tmp/ **原文。**继续.pptx"}';
    expect(preprocessMessageResponse(path).markdown).toBe(path);
  });
});
