import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { TimelineItemContent } from "./task-timeline-items.js";
import { renderToStaticMarkup, completedTurn, snapshot } from "./task-timeline.test-support.js";

describe("task timeline tools", () => {
  it("defers completed ANSI command output until the tool is opened", () => {
    const ansiOutput = "\u001B[31m失败\u001B[0m\n请检查日志";
    const commandSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              command: "pnpm check",
              cwd: "/workspace/Codexly",
              id: "command-completed",
              output: ansiOutput,
              outputTruncated: true,
              status: "completed",
              type: "command",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={commandSnapshot} />);

    expect(markup).toContain("pnpm check");
    expect(markup).toContain("已完成");
    expect(markup).not.toContain('data-terminal=""');
    expect(markup).not.toContain('aria-label="复制命令输出"');
    expect(markup).not.toContain("请检查日志");
    expect(markup).not.toContain("\u001B[31m");
    expect(markup).not.toContain("输出已截断，仅显示最新内容。");
  });

  it("renders command input before output when the tool is expanded", () => {
    const commandElement = TimelineItemContent({
      isLastTurnItem: true,
      item: {
        command: "pnpm check",
        cwd: "/workspace/Codexly",
        id: "command-expanded",
        output: "268 passed",
        outputTruncated: false,
        status: "completed",
        type: "command",
      },
      onOpenFileDiff: vi.fn(),
      onOpenSourceFile: vi.fn(),
      projectId: "codexly",
      taskId: "task-1",
      turnStatus: "completed",
    }) as ReactElement<{ children: ReactNode }>;

    // 直接渲染 Tool 子节点，模拟用户展开后的延迟挂载内容。
    const markup = renderToStaticMarkup(commandElement.props.children);

    expect(markup).toContain("参数");
    expect(markup).toContain("&quot;command&quot;: &quot;pnpm check&quot;");
    expect(markup).toContain("&quot;cwd&quot;: &quot;/workspace/Codexly&quot;");
    expect(markup).toContain("268 passed");
    expect(markup.indexOf("参数")).toBeLessThan(markup.indexOf("268 passed"));
  });

  it("keeps a running command collapsed while preserving its visible running status", () => {
    const runningCommandSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              command: "pnpm test",
              cwd: "/workspace/Codexly",
              id: "command-running",
              outputTruncated: false,
              status: "running",
              type: "command",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningCommandSnapshot} />);

    expect(markup).not.toMatch(/<details[^>]* open/u);
    expect(markup).not.toContain('data-terminal=""');
    expect(markup).not.toContain("/workspace/Codexly");
    expect(markup).toContain('aria-label="AI 回复正在运行：pnpm test"');
    expect(markup).toContain("正在运行 pnpm test");
  });

  it("keeps the latest completed operation visible while the turn continues", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              command: "sed -n '1,240p' SKILL.md",
              cwd: "/workspace/Codexly",
              id: "command-read-skill",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              content: "",
              id: "reasoning-after-command",
              summary: "",
              type: "reasoning",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).toContain('data-agent-shimmer=""');
    expect(markup).toContain('aria-label="AI 回复正在运行：sed -n &#x27;1,240p&#x27; SKILL.md"');
    expect(markup).toContain("正在运行 sed -n &#x27;1,240p&#x27; SKILL.md");
    expect(markup).not.toContain("已运行");
  });

  it("hides transient context compaction after assistant streaming resumes", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "activity-context-compaction",
              label: "上下文压缩",
              status: "completed",
              transient: true,
              type: "activity",
            },
            {
              id: "message-after-compaction",
              role: "assistant",
              text: "继续处理当前任务。",
              type: "message",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).not.toContain("上下文压缩");
    expect(markup).toContain('aria-label="AI 回复正在运行"');
    expect(markup).not.toContain('aria-label="AI 回复正在运行：上下文压缩"');
  });

  it("shows transient context compaction only while it is running", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "activity-context-compaction",
              label: "上下文压缩",
              status: "running",
              transient: true,
              type: "activity",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={runningSnapshot} />);

    expect(markup).toContain('aria-label="AI 回复正在运行：上下文压缩"');
    expect(markup).toContain("正在运行 上下文压缩");
  });

  it("does not retain transient context compaction after the turn completes", () => {
    const completedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "activity-context-compaction",
              label: "上下文已压缩",
              transient: true,
              type: "activity",
            },
            {
              id: "message-after-compaction",
              phase: "final_answer",
              role: "assistant",
              text: "处理完成。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={completedSnapshot} />);

    expect(markup).toContain("处理完成。");
    expect(markup).not.toContain("上下文已压缩");
  });

  it("defers completed generic tool input and output until the tool is opened", () => {
    const toolSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "tool-read-file",
              input: { path: "src/index.ts" },
              name: "read_file",
              output: { content: "export {};", lines: 1 },
              status: "completed",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={toolSnapshot} />);

    expect(markup).toContain("read_file");
    expect(markup).toContain("已完成");
    expect(markup).not.toContain(">参数<");
    expect(markup).not.toContain(">结果<");
    expect(markup).not.toContain("&quot;path&quot;: &quot;src/index.ts&quot;");
    expect(markup).not.toContain("&quot;lines&quot;: 1");
  });

  it("maps declined and interrupted agent items to official tool terminal states", () => {
    const toolSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "tool-declined",
              name: "request_permission",
              status: "declined",
              type: "tool",
            },
            {
              id: "tool-interrupted",
              name: "background_task",
              output: "连接已中断",
              status: "interrupted",
              type: "tool",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={toolSnapshot} />);

    expect(markup).toContain("已拒绝");
    expect(markup).toContain("失败");
    expect(markup).not.toContain('data-operation-group=""');
    expect(markup).not.toMatch(/<details[^>]* open/u);
    expect(markup).not.toContain(">错误<");
    expect(markup).not.toContain("连接已中断");
  });
});
