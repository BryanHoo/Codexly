import { describe, expect, it, vi } from "vitest";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import {
  resolveMessageResponseRendering,
  TaskSnapshotTimeline,
  TaskTimeline,
} from "./task-timeline.js";
import { FileChangeButton } from "./task-timeline-file-changes.js";
import {
  renderToStaticMarkup,
  completedTurn,
  snapshot,
  unpaginatedRuntime,
} from "./task-timeline.test-support.js";

describe("task timeline basics", () => {
  it("renders a fixed scope name without a Project selector", () => {
    const markup = renderToStaticMarkup(
      <TaskTimeline projectId="temporary" scopeName="临时任务" temporary />,
    );

    expect(markup).toContain("临时任务");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain('value="temporary"');
  });

  it("renders a file change without a native path tooltip", () => {
    const markup = renderToStaticMarkup(
      <FileChangeButton
        change={{ diff: "@@ -1 +1 @@\n-old\n+new", kind: "update", path: "src/example.ts" }}
        onOpen={vi.fn()}
      />,
    );

    expect(markup).not.toContain('title="src/example.ts"');
    expect(markup).toContain("example.ts");
  });

  it("renders the older history action for a paginated task", () => {
    const paginatedSnapshot = { ...snapshot, turnsNextCursor: "older-page" };
    const store = createTaskStore(
      { projectId: snapshot.projectId, taskId: snapshot.id },
      {
        checkpoint: { sequence: 0, sessionId: "test-session" },
        snapshot: paginatedSnapshot,
      },
    );
    const markup = renderToStaticMarkup(
      <TaskTimeline
        projectId={snapshot.projectId}
        runtime={{
          ...unpaginatedRuntime,
          connectionState: "connected",
          error: null,
          hasOlderHistory: true,
          isLoadingOlderHistory: false,
          isPending: false,
          loadOlderHistory: vi.fn(),
          olderHistoryError: null,
          snapshot: paginatedSnapshot,
          store,
        }}
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("加载更早记录");
  });

  it("renders automatic approval review results in the assistant timeline", () => {
    const approvalReviewSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              action: { detail: "/bin/zsh -lc pwd", type: "command" },
              id: "auto-approval-review-review-1",
              rationale: "The user explicitly requested this read-only command.",
              riskLevel: "low",
              status: "approved",
              targetItemId: "command-1",
              type: "approval_review",
              userAuthorization: "high",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={approvalReviewSnapshot} />);

    expect(markup).toContain("自动审批：已批准");
    expect(markup).toContain("/bin/zsh -lc pwd");
    expect(markup).toContain("风险：低");
    expect(markup).toContain("用户授权：高");
    expect(markup).toContain("The user explicitly requested this read-only command.");
  });

  it("localizes the running state in English", async () => {
    await changeAppLanguage("en");
    try {
      const markup = renderToStaticMarkup(
        <TaskTimeline
          onProjectChange={() => undefined}
          projectId="项目-alpha"
          projects={[
            {
              createdAt: "2026-07-22T06:00:00.000Z",
              id: "项目-alpha",
              name: "项目-alpha",
              roots: [{ id: "root-alpha", path: "/workspace/项目-alpha" }],
            },
          ]}
          submissionStartedAt="2026-07-24T00:00:00.000Z"
        />,
      );

      expect(markup).toContain("Running");
      expect(markup).toContain('aria-label="AI response is running"');
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("keeps user and AI content unchanged when the interface is English", async () => {
    await changeAppLanguage("en");
    try {
      const contentSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        settings: { ...snapshot.settings, model: "gpt-5.6-codex" },
        turns: [
          {
            ...completedTurn,
            items: [
              {
                id: "message-user-raw",
                role: "user",
                text: "请保留中文输入与 Codex 专有名词",
                type: "message",
              },
              {
                id: "message-assistant-raw",
                role: "assistant",
                text: "已保留原始 AI 输出：Reasoning effort",
                type: "message",
              },
            ],
          },
        ],
      };

      const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={contentSnapshot} />);

      expect(markup).toContain("请保留中文输入与 Codex 专有名词");
      expect(markup).toContain("已保留原始 AI 输出：Reasoning effort");
      expect(markup).toContain("Copy message");
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("preserves soft line breaks only in user messages", () => {
    const multilineSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-user-multiline",
              role: "user",
              text: "Epic：物资管理平台\n├── Feature：物资分类数据模型\n│   └── Story：创建数据库表",
              type: "message",
            },
            {
              id: "message-assistant-multiline",
              role: "assistant",
              text: "第一段回复\n第二段回复",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={multilineSnapshot} />);

    expect(markup.match(/whitespace-pre-wrap!/g)).toHaveLength(1);
  });

  it("uses streaming Markdown only for the active assistant tail item", () => {
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "assistant",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: true, mode: "streaming" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: false,
        role: "assistant",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "user",
        turnStatus: "running",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
    expect(
      resolveMessageResponseRendering({
        isLastTurnItem: true,
        role: "assistant",
        turnStatus: "completed",
      }),
    ).toEqual({ isAnimating: false, mode: "static" });
  });

  it("shows the running shimmer while a new chat submission is pending", () => {
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
        ]}
        submissionStartedAt="2026-07-24T00:00:00.000Z"
      />,
    );

    expect(markup).toContain('data-agent-shimmer=""');
    expect(markup).toContain('aria-label="AI 回复正在运行"');
    expect(markup).toContain("正在运行");
  });

  it("keeps the local submission timer until the confirmed Turn produces assistant output", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:01:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          ...snapshot.turns,
          {
            completedAt: null,
            error: null,
            id: "turn-confirmed-without-output",
            items: [
              {
                id: "submitted-user-turn-confirmed-without-output",
                role: "user",
                text: "继续排查白屏",
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
            snapshot: runningSnapshot,
            store,
          }}
          submissionStartedAt="2026-07-24T00:01:00.000Z"
          submissionTurnId="turn-confirmed-without-output"
          taskId={snapshot.id}
        />,
      );

      expect(markup).toContain("5s");
      expect(markup).not.toContain("1m 5s");
      expect(markup.match(/aria-label="AI 回复正在运行"/gu)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
