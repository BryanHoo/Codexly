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
