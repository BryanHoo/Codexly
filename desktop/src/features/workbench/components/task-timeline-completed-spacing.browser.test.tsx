import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import "../../../shared/styles/globals.css";

it.each([false, true])("完成回合不累积空条目间距（由运行态完成：%s）", async (live) => {
  await i18n.changeLanguage("zh-CN");
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Spacing", pinned: false,
      updatedAt: "2026-10-28T00:01:00Z", status: live ? "running" : "idle", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{
        id: "turn", status: live ? "running" : "completed", startedAt: "2026-10-28T00:00:00Z",
        completedAt: live ? null : "2026-10-28T00:01:00Z", error: null,
        items: [
          { id: "reasoning", type: "reasoning", text: "检查并修改文件" },
          ...Array.from({ length: 18 }, (_, index) => ({
            id: `change-${index}`, type: "file_change" as const, status: "completed" as const,
            changes: [{ path: `src/file-${index}.ts`, kind: "update" as const, diff: "", stats: { additions: 1, removals: 0 } }],
          })),
          { id: "reply", type: "message", role: "assistant", phase: "final_answer", text: "已完成修复并验证。" },
        ],
      }],
    },
  });
  const screen = await render(<TooltipProvider><div style={{ height: 700, width: 800 }}>
    <TaskStoreTimeline connected store={store}
      onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
      onReviewFileChanges={() => undefined} onResolvePendingRequest={async () => undefined} />
  </div></TooltipProvider>);
  const reply = screen.getByText("已完成修复并验证。", { exact: true });
  await expect.element(reply).toBeVisible();
  if (live) {
    store.getState().applyEvents([{
      version: 2, provider: "codex", sessionId: "session", sequence: 1,
      taskId: "task", turnId: "turn", timestamp: "2026-10-28T00:01:00Z",
      type: "turn.completed", payload: { turn: {
        id: "turn", status: "completed", startedAt: "2026-10-28T00:00:00Z",
        completedAt: "2026-10-28T00:01:00Z", error: null, items: [],
      } },
    }]);
  }
  await expect.element(screen.getByRole("button", { name: "展开执行过程", exact: true })).toBeVisible();
  const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]")!;
  const gap = () => reply.element().getBoundingClientRect().top - timer.getBoundingClientRect().bottom;
  // 加载真实 CSS 测量布局，文件修改数量增加时不能挤开最终正文。
  expect(gap()).toBeLessThanOrEqual(24);
  expect(timer.querySelector("time")?.textContent).toBe("1m 0s");
  await expect.element(screen.getByRole("region", { name: "本次修改了 18 个文件", exact: true })).toBeVisible();
  expect(screen.container.querySelectorAll('[data-agent-entry*="change-"]')).toHaveLength(0);
  await screen.getByRole("button", { name: "展开执行过程", exact: true }).click();
  await expect.element(screen.getByText("检查并修改文件", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "收起执行过程", exact: true }).click();
  await expect.element(screen.getByText("检查并修改文件", { exact: true })).not.toBeInTheDocument();
  expect(gap()).toBeLessThanOrEqual(24);
});
