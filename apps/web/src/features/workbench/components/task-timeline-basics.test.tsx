import { describe, expect, it, vi } from "vitest";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskItemKey, createTaskStore } from "../../conversation/runtime/task-store.js";
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

  it("renders a stable anchor for every assistant message", () => {
    const assistantId = "message-assistant-anchor";
    const anchoredSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: assistantId,
              role: "assistant",
              text: "需要高亮的历史答复",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={anchoredSnapshot} />);
    const anchorId = createTaskItemKey(completedTurn.id, assistantId).replaceAll('"', "&quot;");

    expect(markup).toContain(`data-conversation-anchor="${anchorId}"`);
  });

  it("shows only tool duration immediately before its status", () => {
    const timedSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          itemTimings: {
            "user-1": { startedAtMs: 1_753_318_799_000, completedAtMs: 1_753_318_799_250 },
            "message-1": { startedAtMs: 1_753_318_800_000, completedAtMs: 1_753_318_802_500 },
            "command-1": { startedAtMs: 1_753_318_803_000, completedAtMs: 1_753_318_805_500 },
            "tool-1": { startedAtMs: 1_753_318_806_000, completedAtMs: 1_753_318_806_250 },
            "subagent-1": { startedAtMs: 1_753_318_807_000, completedAtMs: 1_753_318_808_000 },
          },
          items: [
            { id: "user-1", role: "user", text: "开始", type: "message" },
            { id: "message-1", role: "assistant", text: "已完成", type: "message" },
            {
              command: "pwd",
              cwd: "/workspace",
              id: "command-1",
              outputOmitted: { bytes: 0, lines: 0 },
              status: "completed",
              type: "command",
            },
            { id: "tool-1", name: "read_file", status: "completed", type: "tool" },
            { id: "subagent-1", name: "agent/wait", status: "completed", type: "tool" },
          ],
        },
      ],
    };
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={timedSnapshot} />);
    expect(markup).not.toContain("data-item-timing");
    expect(markup).toContain("2.5s");
    expect(markup).toContain("250ms");
    expect(markup).toMatch(/data-tool-duration[^>]*>2\.5s<\/span>\s*<span[^>]*>.*?已完成/su);
    expect(markup).toMatch(/data-tool-duration[^>]*>250ms<\/span>\s*<span[^>]*>.*?已完成/su);
    expect(markup).toMatch(
      /data-tool-duration[^>]*>1s<\/span>\s*<span[^>]*>.*?sr-only[^>]*>已完成/su,
    );
    expect(markup).not.toContain(new Date(1_753_318_800_000).toISOString());
    expect(markup).not.toContain(new Date(1_753_318_803_000).toISOString());
    expect(markup).not.toContain('dateTime="2026-07-24T00:00:00.000Z"');
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
