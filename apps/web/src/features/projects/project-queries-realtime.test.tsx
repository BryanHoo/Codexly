import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import { TaskSnapshotTimeline } from "../workbench/components/task-timeline.js";
import {
  projectTasksInfiniteQueryOptions,
  type ProjectTaskInfiniteData,
  updateNewTaskTitleFromSnapshotInInfiniteData,
} from "./project-queries.js";
import { task, snapshot } from "./project-queries.test-support.js";

describe("project realtime queries", () => {
  it("replaces the new-chat title when the first assistant reply starts", () => {
    const newTask = { ...task, title: "新聊天" };
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [newTask], nextCursor: null }],
    } satisfies ProjectTaskInfiniteData;
    const runningSnapshot = {
      ...snapshot,
      status: "running" as const,
      title: "新聊天",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "user-message",
              role: "user" as const,
              text: "修复停止回复后内容消失\n并更新标题",
              type: "message" as const,
            },
            {
              id: "assistant-message",
              role: "assistant" as const,
              text: "我来检查。",
              type: "message" as const,
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running" as const,
        },
      ],
    };

    expect(updateNewTaskTitleFromSnapshotInInfiniteData(currentData, runningSnapshot)).toEqual({
      pageParams: [undefined],
      pages: [
        {
          data: [{ ...newTask, title: "修复停止回复后内容消失" }],
          nextCursor: null,
        },
      ],
    });
  });

  it("uses the realtime assistant-start signal when the HTTP snapshot is one event behind", () => {
    const newTask = { ...task, title: "新聊天" };
    const currentData = {
      pageParams: [undefined],
      pages: [{ data: [newTask], nextCursor: null }],
    } satisfies ProjectTaskInfiniteData;
    const laggingSnapshot = {
      ...snapshot,
      status: "running" as const,
      title: "新聊天",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "user-message",
              role: "user" as const,
              text: "修复后台任务标题同步\n处理流式竞态",
              type: "message" as const,
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running" as const,
        },
      ],
    };

    expect(
      updateNewTaskTitleFromSnapshotInInfiniteData(currentData, laggingSnapshot, {
        assistantReplyStarted: true,
      }),
    ).toEqual({
      pageParams: [undefined],
      pages: [
        {
          data: [{ ...newTask, title: "修复后台任务标题同步" }],
          nextCursor: null,
        },
      ],
    });
  });

  it("stops pagination when the provider repeats the current cursor", () => {
    const queryOptions = projectTasksInfiniteQueryOptions("codexly", {
      listProjects: vi.fn(),
      listTasks: vi.fn(),
      readTask: vi.fn(),
    });
    const repeatedCursorPage = { data: [task], nextCursor: "same-cursor" };

    expect(
      queryOptions.getNextPageParam(repeatedCursorPage, [repeatedCursorPage], "same-cursor", [
        "same-cursor",
      ]),
    ).toBeUndefined();
  });

  it("renders structured items and reasoning summaries without exposing raw reasoning", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <TaskSnapshotTimeline snapshot={snapshot} />
      </TooltipProvider>,
    );

    for (const text of [
      "读取真实历史",
      "模型服务不可用",
      "pnpm check",
      "index.ts",
      "filesystem/read_file",
      "1. 定义协议",
      "上下文压缩",
      "分析协议",
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain("Turn 执行失败");
    expect(markup).not.toContain("输出已截断");
    expect(markup).not.toContain("按统一边界实现");
  });
});
