import { expect, test, vi } from "vitest";
import { taskSettingsMutationOptions } from "./project-query-options.js";

test("keeps live target separate from persisted task settings", async () => {
  const settings = { approvalPolicy: "on-request", approvalsReviewer: "auto_review",
    model: "gpt-6-astra", reasoningEffort: "high", sandboxMode: "workspace-write" } as const;
  const updateTaskSettings = vi.fn(async () => ({ settings, reviewerUpdate: "targetUnavailable" as const }));
  const options = taskSettingsMutationOptions("project-a", "task-a", { updateTaskSettings });
  const result = await options.mutationFn!({ settings, turnId: "original-turn" }, {} as never);
  expect(updateTaskSettings).toHaveBeenCalledExactlyOnceWith("project-a", "task-a", settings, "original-turn");
  expect(result.reviewerUpdate).toBe("targetUnavailable");
  expect(options.scope).toEqual({ id: "task-settings:project-a:task-a" });
});
