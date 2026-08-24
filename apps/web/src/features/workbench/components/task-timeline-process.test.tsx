import { describe, expect, it } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { resolveCompletedTurnProcessItemIds, TaskSnapshotTimeline } from "./task-timeline.js";
import { getUserMessageCopyText } from "./task-timeline-store-items.js";
import { renderToStaticMarkup, completedTurn, snapshot } from "./task-timeline.test-support.js";

describe("task timeline process", () => {
  it("removes the old content-visibility fallback after Turn virtualization", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 51 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={longSnapshot} />);

    expect(markup.match(/data-index=/g)?.length).toBeLessThan(longSnapshot.turns.length);
    expect(markup).not.toContain("content-visibility:auto");
    expect(markup).not.toContain("contain-intrinsic-size:auto_300px");
  });

  it("renders only the raw failed turn error after its partial assistant reply", () => {
    const failedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "failed",
      turns: [
        {
          ...completedTurn,
          error: "上游服务暂时不可用",
          items: [
            {
              id: "message-assistant-partial",
              role: "assistant",
              text: "已经完成部分分析。",
              type: "message",
            },
          ],
          status: "failed",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={failedSnapshot} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("上游服务暂时不可用");
    expect(markup).not.toContain("Turn 执行失败");
    expect(markup.indexOf("已经完成部分分析。")).toBeLessThan(markup.indexOf("上游服务暂时不可用"));
  });

  it("renders skills carried by historical user messages", () => {
    const skillMessageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-user-skill",
              role: "user",
              skills: [{ name: "review-security" }, { name: "documentation-writer" }],
              text: "检查认证边界。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={skillMessageSnapshot} />);

    expect(markup).toContain('data-message-skill="review-security"');
    expect(markup).toContain('data-message-skill="documentation-writer"');
    expect(markup).toContain('data-skill-token=""');
    expect(markup).toContain("$review-security");
    expect(markup).toContain("$documentation-writer");
    expect(markup.indexOf("$review-security")).toBeLessThan(
      markup.indexOf("$documentation-writer"),
    );
    expect(markup).toContain("检查认证边界。");
    expect(markup).not.toContain("SKILL.md");
  });

  it("excludes image and file attachments when copying a user message", () => {
    const copiedText = getUserMessageCopyText({
      attachments: [
        {
          id: "history/image-1",
          kind: "image",
          mediaType: "image/png",
          name: "diagram.png",
          size: 68,
        },
        {
          id: "history/file-1",
          kind: "file",
          mediaType: "application/pdf",
          name: "requirements.pdf",
          size: 128,
        },
      ],
      id: "message-user-copy",
      role: "user",
      skills: [{ name: "review-security" }],
      text: "检查附件描述。",
      type: "message",
    });

    expect(copiedText).toBe("$review-security\n检查附件描述。");
  });

  it("renders reasoning summaries without exposing raw reasoning content", () => {
    const multiItemResponseSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-assistant-progress",
              role: "assistant",
              text: "我先检查消息判定。",
              type: "message",
            },
            {
              content: "正在核对时间线的分组逻辑。",
              id: "reasoning-between-messages",
              summary: "**核对消息分组**",
              type: "reasoning",
            },
            {
              id: "message-assistant-final",
              role: "assistant",
              text: "已修正消息判定。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={multiItemResponseSnapshot} />,
    );

    // 只展示 Codex 提供的摘要，不把原始 reasoning content 传入 DOM。
    expect(markup.match(/data-role="assistant"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(1);
    expect(markup.match(/dateTime="2026-07-24T00:01:00.000Z"/g)).toHaveLength(1);
    expect(markup).toContain("我先检查消息判定。");
    expect(markup).toContain("已修正消息判定。");
    expect(markup).toContain("核对消息分组");
    expect(markup).not.toContain("正在核对时间线的分组逻辑。");
    expect(markup).toContain("data-ai-reasoning");
  });

  it("collapses completed commentary and operations behind the processing time", () => {
    const completedProcessSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-assistant-commentary",
              phase: "commentary",
              role: "assistant",
              text: "正在读取项目配置。",
              type: "message",
            },
            {
              command: "pnpm check",
              cwd: "/workspace",
              exitCode: 0,
              id: "command-check",
              output: "检查过程输出",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              id: "message-assistant-final",
              phase: "final_answer",
              role: "assistant",
              text: "检查完成。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={completedProcessSnapshot} />,
    );

    expect(markup).not.toContain("正在读取项目配置。");
    expect(markup).not.toContain("检查过程输出");
    expect(markup).toContain("检查完成。");
    expect(markup).toContain('data-turn-processing-time=""');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="展开执行过程"');
  });

  it("only classifies documented commentary and pre-final operations as process items", () => {
    const items: RuntimeTaskSnapshot["turns"][number]["items"] = [
      {
        id: "legacy-assistant-message",
        role: "assistant",
        text: "旧版可见消息。",
        type: "message",
      },
      {
        id: "commentary-message",
        phase: "commentary",
        role: "assistant",
        text: "中间过程。",
        type: "message",
      },
      {
        id: "process-activity",
        label: "读取文件",
        type: "activity",
      },
      {
        id: "process-tool",
        name: "read_file",
        status: "completed",
        type: "tool",
      },
      {
        command: "pnpm check",
        cwd: "/workspace",
        id: "process-command",
        outputTruncated: false,
        status: "completed",
        type: "command",
      },
      {
        id: "final-message",
        phase: "final_answer",
        role: "assistant",
        text: "最终结果。",
        type: "message",
      },
      {
        id: "post-final-activity",
        label: "最终回复之后的事件",
        type: "activity",
      },
    ];

    expect(resolveCompletedTurnProcessItemIds(items, "completed")).toEqual([
      "commentary-message",
      "process-activity",
      "process-tool",
      "process-command",
    ]);
    expect(resolveCompletedTurnProcessItemIds(items, "running")).toEqual([]);
  });

  it("does not render assistant actions while its turn is still running", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "message-assistant-progress",
              role: "assistant",
              text: "正在处理。",
              type: "message",
            },
            {
              content: "",
              id: "reasoning-active",
              summary: "**继续思考**",
              type: "reasoning",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline onForkTask={() => Promise.resolve()} snapshot={runningSnapshot} />,
    );

    expect(markup).toContain("正在处理。");
    expect(markup).not.toContain('aria-label="复制消息"');
    expect(markup).not.toContain('aria-label="复制任务"');
    expect(markup).toContain('data-turn-processing-time=""');
    expect(markup).toContain('data-agent-shimmer=""');
    expect(markup).toContain("正在运行");
    expect(markup.indexOf("正在处理。")).toBeLessThan(markup.indexOf("正在运行"));
  });

  it("shows the user message before the 项目 Agent 组件 running shimmer", () => {
    const waitingForAssistantSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "message-user-waiting",
              role: "user",
              text: "你好",
              type: "message",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={waitingForAssistantSnapshot} />,
    );

    expect(markup).toContain('data-agent-shimmer=""');
    expect(markup).toContain("正在运行");
    expect(markup.indexOf("你好")).toBeLessThan(markup.indexOf("正在运行"));
  });

  it("shows completed reasoning summaries without exposing raw content", () => {
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={snapshot} />);

    expect(markup).toContain("data-ai-reasoning");
    expect(markup).toContain("Preparing final build and test verification");
    expect(markup).toContain("Preparing implementation");
  });

  it("renders completed operations individually when no final process fold exists", () => {
    const continuousReasoningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              content: "",
              id: "reasoning-prepare",
              summary: "**准备检查项目**",
              type: "reasoning",
            },
            {
              id: "tool-read-project",
              input: { path: "package.json" },
              name: "read_file",
              output: "Codexly",
              status: "completed",
              type: "tool",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/Codexly",
              id: "command-check-project",
              output: "268 passed",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              content: "",
              id: "reasoning-finish",
              summary: "**整理项目结论**",
              type: "reasoning",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={continuousReasoningSnapshot} />,
    );

    expect(markup).toContain("准备检查项目");
    expect(markup).toContain("整理项目结论");
    expect(markup).not.toContain('data-operation-group=""');
    expect(markup).toContain("read_file");
    expect(markup).toContain("pnpm check");
    expect(markup.indexOf("read_file")).toBeLessThan(markup.indexOf("pnpm check"));
  });

  it("does not render an empty reasoning placeholder", () => {
    const emptyReasoningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [{ content: "", id: "reasoning-empty", summary: "", type: "reasoning" }],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={emptyReasoningSnapshot} />);

    expect(markup).not.toContain('data-ai-chain-of-thought=""');
    expect(markup).not.toContain('data-ai-reasoning=""');
    expect(markup).not.toContain(">推理<");
  });
});
