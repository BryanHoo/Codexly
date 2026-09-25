import { expect, test, vi } from "vitest";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

test.each(["applied", "targetUnavailable"] as const)(
  "transports the exact live target and preserves reviewer outcome %s",
  async (reviewerUpdate) => {
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      model: "gpt-6-astra",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;
    const invoke = vi.fn(async () => ({ settings, reviewerUpdate }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const response = await client.updateTaskSettings("project-a", "thread-a", settings, "turn-live");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("update_task_settings", {
      projectId: "project-a", settings, taskId: "thread-a", turnId: "turn-live",
    });
    expect(response.reviewerUpdate).toBe(reviewerUpdate);
  },
);
