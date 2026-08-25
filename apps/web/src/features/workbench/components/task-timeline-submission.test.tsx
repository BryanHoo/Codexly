import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskTimeline } from "./task-timeline.js";
import {
  renderToStaticMarkup,
  completedTurn,
  snapshot,
  unpaginatedRuntime,
} from "./task-timeline.test-support.js";

describe("task timeline submission", () => {
  it("keeps the local submission timer when a completed Snapshot has no assistant item yet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:01:05.000Z"));
    try {
      const intermediateSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        turns: [
          ...snapshot.turns,
          {
            completedAt: "2026-07-24T00:01:01.000Z",
            error: null,
            id: "turn-completed-without-output",
            items: [
              {
                id: "submitted-user-turn-completed-without-output",
                role: "user",
                text: "继续排查运行提示",
                type: "message",
              },
            ],
            startedAt: "2026-07-24T00:01:00.000Z",
            status: "completed",
          },
        ],
      };
      const store = createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 2, sessionId: "runtime-1" },
          snapshot: intermediateSnapshot,
        },
      );

      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={snapshot.projectId}
          runtime={{
            ...unpaginatedRuntime,
            connectionState: "connected",
            error: null,
            isPending: false,
            store,
          }}
          submissionStartedAt="2026-07-24T00:01:00.000Z"
          submissionTurnId="turn-completed-without-output"
          taskId={snapshot.id}
        />,
      );

      expect(markup).toContain("5s");
      expect(markup.match(/aria-label="AI 回复正在运行"/gu)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the timer to the Turn after its first assistant item arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:01:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-with-output",
            items: [
              {
                id: "submitted-user-turn-with-output",
                role: "user",
                text: "继续排查白屏",
                type: "message",
              },
              {
                id: "assistant-turn-with-output",
                role: "assistant",
                text: "正在检查",
                type: "message",
              },
            ],
            startedAt: "2026-07-24T00:00:00.000Z",
            status: "running",
          },
        ],
      };
      const store = createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 2, sessionId: "runtime-1" },
          snapshot: runningSnapshot,
        },
      );
      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={snapshot.projectId}
          runtime={{
            ...unpaginatedRuntime,
            connectionState: "connected",
            error: null,
            isPending: false,
            store,
          }}
          submissionStartedAt="2026-07-24T00:01:00.000Z"
          submissionTurnId="turn-with-output"
          taskId={snapshot.id}
        />,
      );

      expect(markup).toContain("1m 5s");
      expect(markup).not.toContain('dateTime="PT5S"');
      expect(markup.match(/aria-label="AI 回复正在运行"/gu)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the official-style empty chat prompt around the project selector", () => {
    const markup = renderToStaticMarkup(
      <TaskTimeline
        onProjectChange={() => undefined}
        projectId="codexly"
        projects={[
          {
            createdAt: "2026-07-22T06:00:00.000Z",
            id: "codexly",
            name: "Codexly",
            roots: [{ id: "root-codexly", path: "/workspace/Codexly" }],
          },
          {
            createdAt: "2026-07-22T06:30:00.000Z",
            id: "superwork",
            name: "superwork",
            roots: [{ id: "root-superwork", path: "/workspace/superwork" }],
          },
        ]}
      />,
    );

    expect(markup).toContain('<select aria-label="选择新聊天项目"');
    expect(markup).toContain(">Codexly<");
    expect(markup).toContain("我们应该在");
    expect(markup).toContain("中做些什么？");
    expect(markup).toContain("lucide-message-square-code");
    expect(markup).toContain("size-12");
    expect(markup).toContain("text-xl");
    expect(markup).toContain("mt-5");
    expect(markup).toContain("flex-wrap");
    expect(markup).toContain("items-center");
    expect(markup).toContain("justify-center");
    expect(markup).toContain("underline-offset-4");
    expect(markup).not.toContain("align-middle");
    expect(markup).not.toContain("选择一个任务查看历史。");
    expect(markup).not.toContain("lucide-folder-git-2");
    expect(markup).not.toContain("lucide-cloud");
    expect(markup).not.toContain("lucide-chevron-right");
    expect(markup).not.toContain("lucide-minus");
    expect(markup).not.toContain("size-20");
    expect(markup).not.toContain("text-3xl");
    expect(markup).not.toContain("text-4xl");
    expect(markup).not.toContain("lucide-chevron-down");
    expect(markup).not.toContain('aria-label="切换新聊天项目，当前 Codexly"');
  });

  it("renders live item content from the normalized store instead of a stale root snapshot", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "message-running",
              role: "assistant",
              text: "开始并继续",
              type: "message",
            },
          ],
          startedAt: snapshot.updatedAt,
          status: "running",
        },
      ],
    };
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-1" },
        snapshot: runningSnapshot,
      },
    );
    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={snapshot.projectId}
        runtime={{
          ...unpaginatedRuntime,
          connectionState: "connected",
          error: null,
          isPending: false,
          store,
        }}
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("开始并继续");
  });

  it("normalizes the starting snapshot through the bounded task store", () => {
    const startingSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      pendingRequests: Array.from({ length: 21 }, (_, index) => ({
        availableDecisions: ["allow", "deny"] as const,
        createdAt: `2026-07-24T00:01:${String(index).padStart(2, "0")}.000Z`,
        expiresAt: null,
        grantRoot: `/workspace/expired-${String(index + 1)}`,
        itemId: `file-change-${String(index + 1)}`,
        projectId: snapshot.projectId,
        reason: null,
        requestId: `number:expired-${String(index + 1)}`,
        status: "expired" as const,
        taskId: snapshot.id,
        turnId: completedTurn.id,
        type: "file_change_approval" as const,
      })),
    };

    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={startingSnapshot.projectId}
        runtime={{
          ...unpaginatedRuntime,
          connectionState: "connecting",
          error: null,
          isPending: true,
          store: undefined,
        }}
        startingSnapshot={startingSnapshot}
        taskId={startingSnapshot.id}
      />,
    );

    expect(markup).not.toContain('data-approval-id="number:expired-1"');
    expect(markup).toContain('data-approval-id="number:expired-21"');
  });

  it("virtualizes Turn sections from the normalized store", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 100 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };
    const store = createTaskStore(
      { projectId: longSnapshot.projectId, taskId: longSnapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-long-history" },
        snapshot: longSnapshot,
      },
    );
    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={longSnapshot.projectId}
        runtime={{
          ...unpaginatedRuntime,
          connectionState: "connected",
          error: null,
          isPending: false,
          store,
        }}
        taskId={longSnapshot.id}
      />,
    );

    expect(markup).toContain('aria-label="Turn 1"');
    expect(markup).not.toContain('aria-label="Turn 100"');
  });

  it("renders errors for a failed latest turn in the normalized store", () => {
    const failedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "failed",
      turns: [
        {
          ...completedTurn,
          error: "执行失败",
          items: [
            {
              changes: [{ diff: "+失败前的修改", kind: "update", path: "/workspace/file.ts" }],
              id: "failed-change",
              status: "completed",
              type: "file_change",
            },
          ],
          status: "failed",
        },
      ],
    };
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sequence: 1, sessionId: "runtime-1" },
        snapshot: failedSnapshot,
      },
    );

    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={snapshot.projectId}
        runtime={{
          ...unpaginatedRuntime,
          connectionState: "connected",
          error: null,
          isPending: false,
          store,
        }}
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("执行失败");
  });
});
