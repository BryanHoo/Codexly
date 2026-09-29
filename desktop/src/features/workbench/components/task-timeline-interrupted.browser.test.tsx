import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";

test.each(["interrupted", "failed"] as const)("folds %s output on submission and allows reopening", async (status) => {
  await i18n.changeLanguage("zh-CN");
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-09-23T00:00:01Z", status: "idle", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{
        id: "turn", status, startedAt: "2026-09-23T00:00:00Z",
        completedAt: "2026-09-23T00:00:01Z", error: null,
        items: [
          { id: "user", type: "message", role: "user", text: "Initial request" },
          { id: "partial", type: "message", role: "assistant", phase: "final_answer", text: "Partial output" },
        ],
      }],
    },
  });
  function Harness({ submitting = false }: { submitting?: boolean }) {
    return <TooltipProvider><div style={{ height: 600, width: 800 }}>
      <TaskStoreTimeline connected store={store}
        {...(submitting ? { submissionStartedAt: "2026-09-23T00:00:02Z" } : {})}
        onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined}
        onReviewFileChanges={() => undefined} onResolvePendingRequest={() => Promise.resolve()} />
    </div></TooltipProvider>;
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("Partial output")).toBeVisible();
  await screen.rerender(<Harness submitting />);
  await expect.element(screen.getByText("Partial output")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Initial request")).toBeVisible();
  await screen.getByRole("button", { name: "展开执行过程" }).click();
  await expect.element(screen.getByText("Partial output")).toBeVisible();
  await screen.getByRole("button", { name: "收起执行过程" }).click();
  await expect.element(screen.getByText("Partial output")).not.toBeInTheDocument();
});
