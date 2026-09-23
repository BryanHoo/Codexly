import { describe, expect, it } from "vitest";

import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
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
  it("keeps only the active reasoning expanded without a loading icon", () => {
    const markup = renderRunningReasoning(false);

    expect(markup).toMatch(
      /<details[^>]*data-ai-reasoning=""[^>]*data-streaming="true"[^>]*open=""/u,
    );
    expect(markup).toContain("正在推理");
    expect(markup).not.toContain("animate-spin");
  });

  it("collapses reasoning and changes its icon when the reply starts", () => {
    const markup = renderRunningReasoning(true);
    const reasoning = /<details[^>]*data-ai-reasoning=""[^>]*>[\s\S]*?<\/summary>/u.exec(
      markup,
    )?.[0];

    expect(reasoning).toBeDefined();
    expect(reasoning).toContain('data-streaming="false"');
    expect(reasoning).not.toContain('open=""');
    expect(reasoning).toContain("推理摘要");
    expect(reasoning).not.toContain("正在推理");
    expect(reasoning).toContain('class="lucide lucide-check');
    expect(markup).toContain("已找到原因");
  });

  it("shows the completed icon on a finished turn", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);
    const reasoning = /<details[^>]*data-ai-reasoning=""[^>]*>[\s\S]*?<\/summary>/u.exec(
      markup,
    )?.[0];

    expect(reasoning).toContain('data-streaming="false"');
    expect(reasoning).not.toContain('open=""');
    expect(reasoning).toContain('class="lucide lucide-check');
  });
});
