import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

test("context lists warnings and expands the selected warning detail", async () => {
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-09-23T00:00:00Z", status: "running", pendingRequests: [],
      turns: [], turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model",
        reasoningEffort: "high", sandboxMode: "workspace-write" },
    },
  });
  store.getState().applyEvents([{
    version: 2, provider: "codex", taskId: "task", sessionId: "session",
    sequence: 1, timestamp: "2026-09-23T00:00:01Z", type: "task.notice",
    payload: { code: "runtime_warning", level: "warning", message: "Detailed runtime warning" },
  }]);

  const screen = await render(<TooltipProvider><div style={{ height: 640, width: 360 }}>
    <WorkbenchInspector
      contextOnly projectName="Project" projectPath="/project" projectRootId="root"
      taskId="task" taskStore={store}
    />
  </div></TooltipProvider>);
  const title = i18n.t("timeline.notice.runtime_warning", { ns: "conversation" });
  const summary = screen.getByText(`${title}: Detailed runtime warning`);
  await expect.element(summary).toBeInTheDocument();
  const detail = summary.element().closest("details");
  expect(detail?.open).toBe(false);
  const header = detail?.querySelector("summary");
  expect(header?.getBoundingClientRect().height).toBeGreaterThan(0);
  header?.click();
  expect(detail?.open).toBe(true);
  expect(screen.getByText("Detailed runtime warning", { exact: true }).element()).toBeVisible();
});
