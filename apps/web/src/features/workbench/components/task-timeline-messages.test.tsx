import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskSnapshotTimeline, TaskTimeline } from "./task-timeline.js";
import {
  renderToStaticMarkup,
  completedTurn,
  snapshot,
  unpaginatedRuntime,
} from "./task-timeline.test-support.js";

describe("task timeline messages", () => {
  it("virtualizes Turn sections from a long snapshot", () => {
    const longSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: Array.from({ length: 100 }, (_, index) => ({
        ...completedTurn,
        id: `turn-${String(index + 1)}`,
        items: [],
      })),
    };
    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={longSnapshot} />);

    expect(markup).toContain('aria-label="Turn 1"');
    expect(markup).not.toContain('aria-label="Turn 100"');
  });

  it("removes resolved approvals while keeping pending approvals visible", () => {
    const approvalSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      pendingRequests: [
        {
          availableDecisions: ["allow", "deny"],
          createdAt: "2026-07-24T00:01:01.000Z",
          expiresAt: null,
          grantRoot: "/workspace/resolved-change",
          itemId: "file-change-resolved",
          projectId: "codexly",
          reason: null,
          requestId: "number:resolved",
          status: "resolved",
          taskId: "task-1",
          turnId: "turn-1",
          type: "file_change_approval",
        },
        {
          availableDecisions: ["allow", "deny"],
          createdAt: "2026-07-24T00:01:02.000Z",
          expiresAt: null,
          grantRoot: "/workspace/pending-change",
          itemId: "file-change-pending",
          projectId: "codexly",
          reason: null,
          requestId: "number:pending",
          status: "pending",
          taskId: "task-1",
          turnId: "turn-1",
          type: "file_change_approval",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={approvalSnapshot} />);

    expect(markup).not.toContain("/workspace/resolved-change");
    expect(markup).not.toContain("请求已处理");
    expect(markup).toContain("/workspace/pending-change");
  });

  it("renders copy controls, timestamps, and spacing for user and assistant messages", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              id: "message-user-1",
              role: "user",
              text: "请检查消息工具栏。",
              type: "message",
            },
            {
              id: "message-assistant-1",
              role: "assistant",
              text: "消息工具栏已检查。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={messageSnapshot} />);

    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(2);
    expect(markup).toContain('dateTime="2026-07-24T00:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-24T00:01:00.000Z"');
    expect(markup).toContain("space-y-4");
  });

  it("keeps the completed AI processing duration visible", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          completedAt: "2026-07-24T00:05:07.000Z",
          items: [
            {
              id: "message-assistant-duration",
              role: "assistant",
              text: "回复完成。",
              type: "message",
            },
          ],
        },
      ],
      updatedAt: "2026-07-24T00:05:07.000Z",
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={messageSnapshot} />);

    expect(markup).toContain('data-turn-processing-time=""');
    expect(markup).toContain("已处理");
    expect(markup).toContain('dateTime="PT5M7S"');
    expect(markup).toContain(">5m 7s</time>");
  });

  it("derives the running AI processing duration from the current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:02:05.000Z"));
    try {
      const runningSnapshot: RuntimeTaskSnapshot = {
        ...snapshot,
        status: "running",
        turns: [
          {
            ...completedTurn,
            completedAt: null,
            items: [
              {
                id: "message-assistant-running-duration",
                role: "assistant",
                text: "正在回复。",
                type: "message",
              },
            ],
            status: "running",
          },
        ],
        updatedAt: "2026-07-24T00:02:05.000Z",
      };

      const store = createTaskStore(
        { projectId: runningSnapshot.projectId, taskId: runningSnapshot.id },
        {
          checkpoint: { sequence: 1, sessionId: "runtime-duration" },
          snapshot: runningSnapshot,
        },
      );
      const markup = renderToStaticMarkup(
        <TaskTimeline
          projectId={runningSnapshot.projectId}
          runtime={{
            ...unpaginatedRuntime,
            connectionState: "connected",
            error: null,
            isPending: false,
            store,
          }}
          taskId={runningSnapshot.id}
        />,
      );

      expect(markup).toContain('data-turn-processing-time=""');
      expect(markup).toContain('dateTime="PT2M5S"');
      expect(markup).toContain(">2m 5s</time>");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers task copy beside every terminal AI reply", () => {
    const messageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          status: "interrupted",
          id: "turn-older",
          items: [
            {
              id: "message-assistant-older",
              role: "assistant",
              text: "较早的回复。",
              type: "message",
            },
          ],
        },
        {
          ...completedTurn,
          id: "turn-latest",
          items: [
            {
              id: "message-assistant-latest",
              role: "assistant",
              text: "最新的回复。",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <TaskSnapshotTimeline onForkTask={() => Promise.resolve()} snapshot={messageSnapshot} />,
    );

    expect(markup.match(/aria-label="复制消息"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="复制任务"/g)).toHaveLength(2);
    expect(markup.indexOf('aria-label="复制任务"')).toBeGreaterThan(markup.indexOf("较早的回复。"));
  });

  it("renders one fixed review request instead of native review prompts", () => {
    const reviewSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          ...completedTurn,
          completedAt: null,
          items: [
            {
              id: "review-mode-turn-1",
              target: { type: "uncommitted_changes" },
              type: "review",
            },
            {
              id: "review-command",
              command: "git diff",
              cwd: "/workspace/Codexly",
              outputOmitted: { bytes: 0, lines: 0 },
              status: "running",
              type: "command",
            },
          ],
          status: "running",
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={reviewSnapshot} />);

    expect(markup.match(/请检查我未提交的更改/g)).toHaveLength(1);
    expect(markup).toContain("审查模式");
    expect(markup).not.toContain("Review the current code changes");
    expect(markup.indexOf("请检查我未提交的更改")).toBeLessThan(markup.indexOf("git diff"));
  });

  it("renders user image attachments as standalone previews before the text bubble", () => {
    const imageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              attachments: [
                {
                  id: "history/image-1",
                  kind: "image",
                  mediaType: "image/png",
                  name: "diagram.png",
                  size: 68,
                },
              ],
              id: "message-user-image",
              role: "user",
              text: "阅读并理解项目",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={imageSnapshot} />);

    expect(markup).toContain('aria-label="消息附件"');
    expect(markup).toContain('aria-label="查看图片 diagram.png"');
    expect(markup).toContain(
      'src="/v1/projects/codexly/tasks/task-1/attachments/history%2Fimage-1"',
    );
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('data-message-attachment="image"');
    expect(markup).toContain('data-message-text="true"');
    expect(markup).toContain('width="160"');
    expect(markup).toContain('height="160"');
    expect(markup.indexOf('aria-label="消息附件"')).toBeLessThan(
      markup.indexOf('data-message-text="true"'),
    );
    expect(markup.match(/diagram\.png/g)).toHaveLength(2);
    expect(markup).not.toContain("data:image");
    expect(markup).not.toContain('target="_blank"');
  });

  it("renders generated assistant image attachments without an empty text bubble", () => {
    const imageSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              attachments: [
                {
                  id: "history/generated-image-1",
                  kind: "image",
                  mediaType: "image/png",
                  name: "生成图片-1.png",
                  size: 68,
                },
              ],
              id: "message-assistant-image",
              role: "assistant",
              text: "",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={imageSnapshot} />);

    expect(markup).toContain('aria-label="消息附件"');
    expect(markup).toContain('aria-label="查看图片 生成图片-1.png"');
    expect(markup).toContain(
      'src="/v1/projects/codexly/tasks/task-1/attachments/history%2Fgenerated-image-1"',
    );
    expect(markup).toContain('data-message-attachment="image"');
    expect(markup).not.toContain('data-message-text="true"');
    expect(markup).not.toContain("data:image");
  });

  it("renders pasted text as a file attachment instead of a text bubble", () => {
    const pastedTextSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          items: [
            {
              attachments: [
                {
                  id: "history/pasted-text-1",
                  kind: "text",
                  mediaType: "text/plain",
                  name: "Pasted text.txt",
                  size: 1_001,
                },
              ],
              id: "message-user-pasted-text",
              role: "user",
              text: "",
              type: "message",
            },
          ],
        },
      ],
    };

    const markup = renderToStaticMarkup(<TaskSnapshotTimeline snapshot={pastedTextSnapshot} />);

    expect(markup).toContain('data-message-attachment="text"');
    expect(markup).toContain('data-attachment-preview="file"');
    expect(markup).toContain("Pasted text.txt");
    expect(markup).toContain("1001 B");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain('data-message-text="true"');
  });
});
