import type { AgentTask, Project } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import performanceBudgets from "../../../../../tests/performance-budgets.json" with { type: "json" };
import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";
import { deriveWorkbenchPetActivity } from "./pet-activity.js";

describe("workbench pet activity performance", () => {
  it("derives a large activity map within the linear-time budget", () => {
    const projects: Project[] = Array.from(
      { length: performanceBudgets.petActivity.directories },
      (_, index) => ({
        createdAt: "2026-08-26T00:00:00.000Z",
        id: `project-${String(index)}`,
        name: `Project ${String(index)}`,
        roots: [{ id: `root-${String(index)}`, path: `/workspace/project-${String(index)}` }],
      }),
    );
    const activity = new Map(
      Array.from({ length: performanceBudgets.petActivity.tasks }, (_, index) => [
        `task-${String(index)}`,
        {
          attention: null,
          isRunning: true,
          pendingApprovalRequestIds: new Set<string>(),
          projectId: `project-${String(index % projects.length)}`,
          taskId: `task-${String(index)}`,
        },
      ]),
    ) as TaskActivityMap;
    const tasks: AgentTask[] = Array.from(
      { length: performanceBudgets.petActivity.tasks },
      (_, index) => ({
        id: `task-${String(index)}`,
        pinned: false,
        projectId: `project-${String(index % projects.length)}`,
        title: `Task ${String(index)}`,
        updatedAt: "2026-08-26T00:00:00.000Z",
      }),
    );

    const startedAt = performance.now();
    const result = deriveWorkbenchPetActivity(projects, tasks, activity);
    const durationMs = performance.now() - startedAt;

    expect(result.tasks).toHaveLength(performanceBudgets.petActivity.tasks);
    expect(durationMs).toBeLessThan(performanceBudgets.petActivity.maxDeriveMs);
  });
});
