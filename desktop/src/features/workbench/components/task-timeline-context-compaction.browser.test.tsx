import type { AgentItem, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";

test.each([undefined, "running", "completed"] as const)(
  "folds context compaction and restores its finished entry (item status: %s)",
  async (status) => {
    await i18n.changeLanguage("zh-CN");
    const activity: AgentItem = {
      id: "compaction", type: "activity", label: "上下文压缩", transient: true,
      ...(status === undefined ? {} : { status }),
    };
    const response: AgentTaskSnapshotResponse = {
      checkpoint: { sequence: 0, sessionId: "session" },
      snapshot: {
        id: "task", projectId: "project", title: "Task", pinned: false,
        updatedAt: "2026-10-29T00:00:01Z", status: "idle", pendingRequests: [],
        turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
        settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
          reasoningEffort: "high", sandboxMode: "workspace-write" },
        turns: [{
          id: "turn", status: "completed", startedAt: "2026-10-29T00:00:00Z",
          completedAt: "2026-10-29T00:00:01Z", error: null,
          items: [activity, { id: "answer", type: "message", role: "assistant",
            phase: "final_answer", text: "处理完成。" }],
        }],
      },
    };
    // 运行态用真实回合结束事件接管，另外两种状态直接验证重新打开历史的路径。
    const live = status === "running";
    const store = createTaskStore({ projectId: "project", taskId: "task" }, live ? {
      ...response,
      snapshot: { ...response.snapshot, status: "running", turns: response.snapshot.turns.map((turn) => ({
        ...turn, status: "running", completedAt: null, items: [activity],
      })) },
    } : response);
    const screen = await render(<TooltipProvider><div style={{ height: 600, width: 800 }}>
      <TaskStoreTimeline connected store={store}
        onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
        onReviewFileChanges={() => undefined} onResolvePendingRequest={() => Promise.resolve()} />
    </div></TooltipProvider>);
    await expect.element(screen.getByLabelText(live ? "AI 回复正在运行：上下文压缩" : "展开执行过程")).toBeVisible();
    if (live) {
      store.getState().applyEvents([{
        version: 2, provider: "codex", sessionId: "session", taskId: "task", turnId: "turn",
        timestamp: "2026-10-29T00:00:01Z", sequence: 1, type: "turn.completed",
        payload: { turn: response.snapshot.turns[0]! },
      }]);
    }
    await expect.element(screen.getByText("处理完成。")).toBeVisible();
    await expect.element(screen.getByText("上下文压缩")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "展开执行过程" }).click();
    await expect.element(screen.getByText("上下文压缩")).toBeVisible();
    // 回合终态优先于可能缺失的活动完成事件，展开历史也不能显示运行中的转圈。
    expect(document.querySelector('[data-ai-task][data-status="in_progress"]')).toBeNull();
    await screen.getByRole("button", { name: "收起执行过程" }).click();
    await expect.element(screen.getByText("上下文压缩")).not.toBeInTheDocument();
    await expect.element(screen.getByText("处理完成。")).toBeVisible();
  },
);

test("shows ACP notices and expands streamed compaction summaries in a narrow conversation", async () => {
  await i18n.changeLanguage("zh-CN");
  const turn = {
    id: "turn",
    status: "running" as const,
    startedAt: null,
    completedAt: null,
    error: null,
    items: [],
  };
  const checkpoint = { sequence: 0, sessionId: "session" };
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint,
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-10-29T00:00:01Z", status: "running", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null, turns: [turn],
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
    },
  });
  const view = await render(<TooltipProvider><div style={{ height: 600, width: 390 }}>
    <TaskStoreTimeline connected store={store}
      onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
      onReviewFileChanges={() => undefined} onResolvePendingRequest={() => Promise.resolve()} />
  </div></TooltipProvider>);
  const envelope = {
    version: 2 as const, provider: "codex", sessionId: checkpoint.sessionId,
    taskId: "task", timestamp: "2026-10-29T00:00:02Z",
  };
  const item = { id: "compact", type: "compaction" as const, status: "in_progress", summary: "" };
  store.getState().applyEvents([
    { ...envelope, sequence: 1, turnId: turn.id, itemId: item.id,
      type: "item.started", payload: { item } },
    { ...envelope, sequence: 2, turnId: turn.id, itemId: item.id,
      type: "compaction.summary_delta", payload: { delta: "**已保留**" } },
    { ...envelope, sequence: 3, type: "task.notice",
      payload: { code: "acp_notice", level: "info", severity: "error",
        message: "Agent 提示", description: "<strong>以纯文本显示</strong>" } },
  ]);
  await expect.element(view.getByRole("alert")).toHaveTextContent("<strong>以纯文本显示</strong>");
  await view.getByRole("button", { name: /正在压缩上下文/ }).click();
  await expect.element(view.getByText("已保留")).toBeVisible();
  store.getState().applyEvents([{
    ...envelope, sequence: 4, turnId: turn.id, itemId: item.id,
    type: "item.completed", payload: { item: { ...item, status: "completed", summary: "最终摘要" } },
  }]);
  await expect.element(view.getByRole("button", { name: /上下文压缩完成/ })).toBeVisible();
  await expect.element(view.getByText("最终摘要")).toBeVisible();
  await view.getByRole("button", { name: "关闭会话通知" }).click();
  await expect.element(view.getByText("Agent 提示")).not.toBeInTheDocument();
});
