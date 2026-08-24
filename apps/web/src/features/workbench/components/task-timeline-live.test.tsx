import { describe, expect, it } from "vitest";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskTimeline } from "./task-timeline.js";
import {
  renderToStaticMarkup,
  snapshot,
  unpaginatedRuntime,
} from "./task-timeline.test-support.js";

describe("task timeline live state", () => {
  it("renders live summaries, progress, file updates, runtime status, diff, and notices", () => {
    const runningSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      status: "running",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-live",
          items: [
            {
              content: "不可展示的原始推理",
              id: "reasoning-live",
              summary: "正在核对事件覆盖",
              type: "reasoning",
            },
            {
              id: "tool-live",
              name: "mcp__docs__search",
              status: "running",
              type: "tool",
            },
            {
              changes: [],
              id: "file-live",
              status: "running",
              type: "file_change",
            },
            {
              id: "safety-live",
              kind: "safety_buffering",
              model: "gpt-5.6-sol",
              status: "running",
              type: "runtime_status",
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
        checkpoint: { sequence: 1, sessionId: "runtime-live" },
        snapshot: runningSnapshot,
      },
    );
    const eventBase = {
      provider: "codex",
      sessionId: "runtime-live",
      taskId: snapshot.id,
      timestamp: snapshot.updatedAt,
      version: 2 as const,
    };
    store.getState().applyEvents([
      {
        ...eventBase,
        itemId: "tool-live",
        payload: { message: "正在读取官方 Schema" },
        sequence: 2,
        turnId: "turn-live",
        type: "tool.progress",
      },
      {
        ...eventBase,
        itemId: "file-live",
        payload: {
          changes: [{ diff: "+export const live = true;", kind: "update", path: "src/live.ts" }],
          originalByteLength: 26,
          truncated: false,
        },
        sequence: 3,
        turnId: "turn-live",
        type: "file_change.updated",
      },
      {
        ...eventBase,
        itemId: "file-live",
        payload: {
          item: {
            changes: [{ diff: "+export const live = true;", kind: "update", path: "src/live.ts" }],
            id: "file-live",
            status: "completed",
            type: "file_change",
          },
        },
        sequence: 4,
        turnId: "turn-live",
        type: "item.completed",
      },
      {
        ...eventBase,
        payload: {
          code: "model_verification",
          level: "info",
          message: "provider text should be localized",
        },
        sequence: 6,
        type: "task.notice",
      },
      {
        ...eventBase,
        payload: {
          code: "strict_review_required",
          level: "warning",
          message: "provider strict review text",
        },
        sequence: 7,
        type: "task.notice",
      },
    ]);
    // Zustand 的 SSR 快照固定为建 Store 时的状态；同步瞬时字段以覆盖静态标记输出。
    Object.assign(store.getInitialState(), {
      notices: store.getState().notices,
    });

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
        taskId={snapshot.id}
      />,
    );

    expect(markup).toContain("正在核对事件覆盖");
    expect(markup).not.toContain("不可展示的原始推理");
    expect(markup).toContain("正在读取官方 Schema");
    expect(markup).toContain("已编辑 live.ts，新增 1 行，删除 0 行，打开 Diff");
    expect(markup).toContain("+1");
    expect(markup).toContain("-0");
    expect(markup).not.toContain('aria-label="正在修改 live.ts，新增 1 行，删除 0 行"');
    expect(markup).not.toContain("实时文件变更");
    expect(markup).not.toContain("Turn Diff");
    expect(markup).not.toContain("diff --git a/src/live.ts b/src/live.ts");
    expect(markup).toContain("正在使用安全缓冲模型 gpt-5.6-sol");
    expect(markup).toContain("正在验证模型可用性");
    expect(markup).not.toContain("provider text should be localized");
    expect(markup).toContain("需要严格审核");
    expect(markup).toContain("安全审核已升级，当前操作将在严格审核完成后继续");
    expect(markup).not.toContain("provider strict review text");
  });
});
