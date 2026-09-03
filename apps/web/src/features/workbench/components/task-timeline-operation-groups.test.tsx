import type { AgentItem } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskItemStore } from "../../conversation/runtime/task-store.js";

import {
  filterRenderableTimelineItemKeys,
  groupConsecutiveTimelineOperations,
  summarizeTimelineOperations,
} from "./task-timeline-operation-groups.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

function command(id: string, status: Extract<AgentItem, { type: "command" }>["status"]): AgentItem {
  return {
    command: `echo ${id}`,
    cwd: "/workspace",
    id,
    output: "",
    outputOmitted: { bytes: 0, lines: 0 },
    status,
    type: "command",
  };
}

function tool(id: string, status: Extract<AgentItem, { type: "tool" }>["status"]): AgentItem {
  return { id, name: id, status, type: "tool" };
}

describe("task timeline operation groups", () => {
  it("groups only consecutive tool and command items while preserving timeline order", () => {
    const items: AgentItem[] = [
      tool("tool-1", "completed"),
      command("command-1", "completed"),
      {
        id: "message-1",
        role: "assistant",
        text: "检查完成。",
        type: "message",
      },
      command("command-2", "completed"),
      tool("tool-2", "completed"),
      tool("tool-3", "completed"),
    ];
    const itemsById = new Map(items.map((item) => [item.id, item]));

    expect(
      groupConsecutiveTimelineOperations(
        items.map((item) => item.id),
        (itemKey) => itemsById.get(itemKey),
      ),
    ).toEqual([
      { itemKeys: ["tool-1", "command-1"], key: "tool-1", type: "operation_group" },
      { itemKey: "message-1", type: "item" },
      {
        itemKeys: ["command-2", "tool-2", "tool-3"],
        key: "command-2",
        type: "operation_group",
      },
    ]);
  });

  it("keeps a single operation on the existing item rendering path", () => {
    const item = command("command-only", "completed");

    expect(groupConsecutiveTimelineOperations([item.id], () => item)).toEqual([
      { itemKey: item.id, type: "item" },
    ]);
  });

  it("ignores empty reasoning summaries between consecutive operations", () => {
    const items: AgentItem[] = [
      tool("tool-read", "completed"),
      { content: "", id: "reasoning-empty", summary: " \n ", type: "reasoning" },
      tool("mcp-search", "completed"),
      command("command-check", "completed"),
    ];
    const itemStoresByKey = new Map(
      items.map((item) => [item.id, createTaskItemStore(item)] as const),
    );
    const renderableItemKeys = filterRenderableTimelineItemKeys(
      items.map((item) => item.id),
      itemStoresByKey,
    );

    expect(
      groupConsecutiveTimelineOperations(renderableItemKeys, (itemKey) =>
        itemStoresByKey.get(itemKey)?.peek(),
      ),
    ).toEqual([
      {
        itemKeys: ["tool-read", "mcp-search", "command-check"],
        key: "tool-read",
        type: "operation_group",
      },
    ]);
  });

  it("filters empty reasoning before rendering and restores it after a summary delta", () => {
    const reasoningStore = createTaskItemStore({
      content: "raw reasoning",
      id: "reasoning-streaming",
      summary: "",
      type: "reasoning",
    });
    const toolStore = createTaskItemStore(tool("tool-visible", "completed"));
    const itemStoresByKey = new Map([
      ["reasoning-streaming", reasoningStore],
      ["tool-visible", toolStore],
    ]);
    const readSpy = vi.spyOn(reasoningStore, "read");

    expect(
      filterRenderableTimelineItemKeys(["reasoning-streaming", "tool-visible"], itemStoresByKey),
    ).toEqual(["tool-visible"]);

    reasoningStore.appendDelta({
      itemId: "reasoning-streaming",
      payload: { delta: "流式摘要", field: "summary" },
      provider: "codex",
      sequence: 1,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-03T00:00:00.000Z",
      turnId: "turn-1",
      type: "reasoning.delta",
      version: 2,
    });

    expect(
      filterRenderableTimelineItemKeys(["reasoning-streaming", "tool-visible"], itemStoresByKey),
    ).toEqual(["reasoning-streaming", "tool-visible"]);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("summarizes operation kinds, active state, and unsuccessful terminal states", () => {
    const summary = summarizeTimelineOperations([
      tool("tool-running", "running"),
      tool("tool-failed", "failed"),
      command("command-completed", "completed"),
      command("command-declined", "declined"),
    ]);

    expect(summary).toEqual({
      commandCount: 2,
      failedCount: 2,
      isActive: true,
      toolCount: 2,
    });
  });

  it("collapses terminal operations after assistant text resumes", () => {
    const completedOperationsSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "tool-read-project",
              input: { path: "package.json" },
              name: "read_file",
              output: "隐藏的工具输出",
              status: "completed",
              type: "tool",
            },
            {
              content: "",
              id: "reasoning-empty-before-mcp",
              summary: "",
              type: "reasoning",
            },
            {
              id: "tool-mcp-search",
              input: { query: "timeline grouping" },
              name: "fast-context/search",
              output: "隐藏的 MCP 输出",
              status: "completed",
              type: "tool",
            },
            {
              content: "",
              id: "reasoning-empty-before-command",
              summary: " \n ",
              type: "reasoning",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/Codexly",
              id: "command-check",
              output: "隐藏的命令输出",
              outputOmitted: { bytes: 0, lines: 0 },
              status: "completed",
              type: "command",
            },
            {
              command: "pnpm test",
              cwd: "/workspace/Codexly",
              exitCode: 1,
              id: "command-test",
              output: "隐藏的失败输出",
              outputOmitted: { bytes: 0, lines: 0 },
              status: "failed",
              type: "command",
            },
            {
              id: "message-commentary",
              phase: "commentary",
              role: "assistant",
              text: "继续处理。",
              type: "message",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={completedOperationsSnapshot} />,
    );

    expect(markup).toContain('data-operation-group=""');
    expect(markup).toContain("操作完成：调用 2 个工具，执行 2 条命令；其中 1 项失败");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("继续处理。");
    expect(markup).not.toContain('data-ai-reasoning=""');
    expect(markup).not.toContain("read_file");
    expect(markup).not.toContain("fast-context/search");
    expect(markup).not.toContain("pnpm check");
    expect(markup).not.toContain("隐藏的工具输出");
    expect(markup).not.toContain("隐藏的 MCP 输出");
    expect(markup).not.toContain("隐藏的命令输出");
  });

  it("keeps terminal trailing operations visible until assistant text resumes", () => {
    const trailingOperationsSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [tool("tool-completed", "completed"), command("command-completed", "completed")],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={trailingOperationsSnapshot} />,
    );

    expect(markup).toContain("tool-completed");
    expect(markup).toContain("echo command-completed");
    expect(markup).not.toContain('data-operation-group-active=""');
    expect(markup).not.toContain('data-operation-group=""');
  });

  it("hides completed operations in the Turn process without an operation summary", () => {
    const completedOperationsSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            tool("tool-completed", "completed"),
            command("command-completed", "completed"),
            {
              id: "message-final",
              phase: "final_answer",
              role: "assistant",
              text: "最终回复。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline snapshot={completedOperationsSnapshot} />,
    );

    expect(markup).toContain("最终回复。");
    expect(markup).toContain('aria-label="展开执行过程"');
    expect(markup).not.toContain('data-operation-group=""');
    expect(markup).not.toContain("tool-completed");
    expect(markup).not.toContain("echo command-completed");
  });
});
