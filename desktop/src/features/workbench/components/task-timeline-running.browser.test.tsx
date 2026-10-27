import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";

test.each([false, true])("keeps running through follow-up input and resumed output (async answer: %s)", async (asyncAnswer) => {
  await i18n.changeLanguage("zh-CN");
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-10-27T00:00:01Z", status: "running", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{
        id: "turn", status: "running", startedAt: "2026-10-27T00:00:00Z",
        completedAt: null, error: null,
        items: [
          { id: "initial", type: "message", role: "user", text: "执行任务" },
          { id: "previous-output", type: "message", role: "assistant", text: "正在处理",
            ...(asyncAnswer ? { questions: [{ title: "选择执行方式", options: ["继续"] }] } : {}) },
        ],
      }],
    },
  });
  const screen = await render(<TooltipProvider><div style={{ height: 600, width: 800 }}>
    <TaskStoreTimeline connected store={store}
      onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
      onReviewFileChanges={() => undefined} onResolvePendingRequest={() => Promise.resolve()} />
  </div></TooltipProvider>);
  const running = screen.getByLabelText("AI 回复正在运行", { exact: true });
  await expect.element(running).toBeVisible();
  const eventBase = { version: 2 as const, provider: "codex", sessionId: "session", taskId: "task", turnId: "turn", timestamp: "2026-10-27T00:00:02Z" };
  // 使用真实 Store 事件验证用户输入与后续输出之间的空档，并检查运行提示始终只有一处。
  store.getState().applyEvents([{
    ...eventBase, sequence: 1, itemId: "follow-up", type: "item.completed",
    payload: { item: { id: "follow-up", type: "message", role: "user", text: asyncAnswer ? "选择继续" : "补充执行要求" } },
  }]);
  await expect.element(screen.getByText(asyncAnswer ? "选择继续" : "补充执行要求")).toBeVisible();
  await expect.element(running).toBeVisible();
  expect(document.querySelectorAll('[aria-label="AI 回复正在运行"]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-turn-processing-time]')).toHaveLength(1);
  store.getState().applyEvents([{
    ...eventBase, sequence: 2, itemId: "resumed-output", type: "item.completed",
    payload: { item: { id: "resumed-output", type: "message", role: "assistant", text: "继续执行" } },
  }]);
  await expect.element(screen.getByText("继续执行", { exact: true })).toBeVisible();
  await expect.element(running).toBeVisible();
  expect(document.querySelectorAll('[aria-label="AI 回复正在运行"]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-turn-processing-time]')).toHaveLength(1);
  store.getState().applyEvents([{
    ...eventBase, sequence: 3, type: "turn.completed",
    payload: { turn: { id: "turn", status: "completed", startedAt: "2026-10-27T00:00:00Z", completedAt: "2026-10-27T00:00:03Z", error: null, items: [] } },
  }]);
  await expect.element(running).not.toBeInTheDocument();
});
