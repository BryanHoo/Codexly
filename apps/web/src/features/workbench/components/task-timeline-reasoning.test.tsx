import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { TimelineItemContent } from "./task-timeline-items.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

function renderRunningReasoning(withReply: boolean) {
  const runningSnapshot: RuntimeTaskSnapshot = {
    ...snapshot,
    status: "running",
    turns: [
      {
        ...completedTurn,
        completedAt: null,
        items: [
          { content: "", id: "reasoning-1", summary: "正在分析问题", type: "reasoning" },
          ...(withReply
            ? [
                {
                  id: "reply-1",
                  role: "assistant" as const,
                  text: "已找到原因",
                  type: "message" as const,
                },
              ]
            : []),
        ],
        status: "running",
      },
    ],
  };

  return renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);
}

describe("task timeline reasoning", () => {
  it.each(["**Evaluating API support**", "## Evaluating API support"])(
    "shows the opening title only in the header: %s",
    (title) => {
      const markup = renderToStaticMarkup(
        <TimelineItemContent
          isLastTurnItem
          item={{
            content: "原始推理不应显示",
            id: "reasoning-title",
            summary: `${title}\n\n正在检查实际支持的 API。`,
            type: "reasoning",
          }}
          onOpenFileDiff={() => undefined}
          onOpenSourceFile={() => undefined}
          projectId="project"
          taskId="task"
          turnStatus="running"
        />,
      );
      expect(markup).toContain("Evaluating API support");
      expect(markup.slice(markup.indexOf("</button>") + 9)).not.toContain("Evaluating API support");
      expect(markup).toContain("正在检查实际支持的 API。");
      expect(markup).not.toContain("原始推理不应显示");
    },
  );

  it("shows a single-line title and expands live reasoning", () => {
    const markup = renderRunningReasoning(false);
    const reasoning = /<div[^>]*data-reasoning-summary=""[^>]*>[\s\S]*?<\/button>/u.exec(
      markup,
    )?.[0];

    expect(reasoning).toBeDefined();
    expect(reasoning).toContain("trace-collapsible");
    expect(reasoning).toContain('aria-expanded="true"');
    expect(reasoning).toMatch(/<span[^>]*data-slot="trace-title"[^>]*>正在分析问题<\/span>/u);
    expect(markup).not.toContain("正在推理");
    expect(reasoning).toContain("lucide-loader-circle");
  });

  it("shows markdown summary as plain text in the title and excludes raw reasoning", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              content: "原始推理不应显示",
              id: "reasoning-long",
              summary:
                "## **Detaching from Redis init**\n\n查看 [Redis 配置](https://example.com) 和 `init.ts`",
              type: "reasoning",
            },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).toContain('data-reasoning-summary=""');
    expect(markup).toMatch(
      /<button[^>]*>[\s\S]*<span[^>]*data-slot="trace-title"[^>]*>Detaching from Redis init 查看 Redis 配置 和 init\.ts<\/span>[\s\S]*<\/button>/u,
    );
    expect(markup).not.toContain("**Detaching from Redis init**");
    expect(markup).not.toContain("https://example.com");
    expect(markup).not.toContain("原始推理不应显示");
  });

  it("stays collapsed after the reply starts", () => {
    const markup = renderRunningReasoning(true);
    const reasoning = /<div[^>]*data-reasoning-summary=""[^>]*>[\s\S]*?<\/button>/u.exec(
      markup,
    )?.[0];

    expect(reasoning).toBeDefined();
    expect(reasoning).not.toContain('open=""');
    expect(reasoning).toContain("正在分析问题");
    expect(markup).toContain("已找到原因");
  });

  it("uses the same collapsed tool presentation on a finished turn", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);
    const reasoning = /<div[^>]*data-reasoning-summary=""[^>]*>[\s\S]*?<\/button>/u.exec(
      markup,
    )?.[0];

    expect(reasoning).toContain("trace-collapsible");
    expect(reasoning).not.toContain('open=""');
    expect(reasoning).not.toContain("推理摘要");
  });
});
