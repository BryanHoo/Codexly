import { expect, test, vi } from "vitest";
import type { AgentTaskSnapshotResponse, AgentItem } from "@/protocol/index.js";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";

const { readTask } = vi.hoisted(() => ({ readTask: vi.fn() }));
vi.mock("../../projects/project-context-state.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../projects/project-context-state.js")>(),
  useProjectData: () => ({ client: { readTask } }),
}));

test.each([false, true])("folds async question history and reopens it (paginated: %s)", async (paginated) => {
  await i18n.changeLanguage("zh-CN");
  const items: AgentItem[] = [
    { id: "user", type: "message", role: "user", text: "修复展示问题" },
    { id: "question", type: "message", role: "assistant", phase: "final_answer", text: "问题原文",
      questions: [{ title: "请确认登录状态", options: ["已登录", "稍后处理"] }] },
    { id: "answer", type: "message", role: "assistant", phase: "final_answer", text: "已完成修复" },
  ];
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-10-27T00:00:01Z", status: "idle", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{
        id: "turn", status: "completed", startedAt: "2026-10-27T00:00:00Z",
        completedAt: "2026-10-27T00:00:01Z", error: null, items,
      }],
    },
  };
  readTask.mockReset().mockResolvedValue(response);
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    ...response, snapshot: { ...response.snapshot, turns: response.snapshot.turns.map((turn) => ({
      ...turn, ...(paginated ? { processCursor: "question-process" } : {}),
    })) },
  });
  const screen = await render(<TooltipProvider><div style={{ height: 600, width: 800 }}>
    <TaskStoreTimeline connected store={store}
      onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
      onReviewFileChanges={() => undefined} onResolvePendingRequest={() => Promise.resolve()} />
  </div></TooltipProvider>);
  await expect.element(screen.getByText("已完成修复")).toBeVisible();
  await expect.element(screen.getByText("请确认登录状态")).not.toBeInTheDocument();
  expect(readTask).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "展开执行过程" }).click();
  await expect.element(screen.getByText("请确认登录状态")).toBeVisible();
  await expect.element(screen.getByText("稍后处理")).toBeVisible();
  await expect.element(screen.getByText("已完成修复")).toBeVisible();
  await screen.getByRole("button", { name: "收起执行过程" }).click();
  await expect.element(screen.getByText("请确认登录状态")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "展开执行过程" }).click();
  await expect.element(screen.getByText("请确认登录状态")).toBeVisible();
  expect(readTask).toHaveBeenCalledTimes(paginated ? 1 : 0);
});
