import { TEMPORARY_TASK_SCOPE_ID, type AgentTask, type Project } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import type { TaskActivityMap } from "../conversation/runtime/task-activity.js";
import { deriveWorkbenchPetActivity } from "./pet-activity.js";

type ActivityInput = Readonly<{
  attention?: "approval" | "completed" | "failed" | null;
  isRunning?: boolean;
  pending?: number;
  projectId: string;
  taskId: string;
}>;

function createActivity(inputs: readonly ActivityInput[]): TaskActivityMap {
  return new Map(
    inputs.map((input) => [
      input.taskId,
      {
        attention: input.attention ?? null,
        isRunning: input.isRunning ?? false,
        pendingApprovalRequestIds: new Set(
          Array.from({ length: input.pending ?? 0 }, (_, index) => `request-${String(index)}`),
        ),
        projectId: input.projectId,
        taskId: input.taskId,
      },
    ]),
  );
}

function project(id: string, path: string, name = id): Project {
  return {
    createdAt: "2026-08-26T00:00:00.000Z",
    id,
    name,
    roots: [{ id: `${id}-root`, path }],
  };
}

function task(id: string, projectId: string, title: string): AgentTask {
  return {
    id,
    pinned: false,
    projectId,
    title,
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

describe("deriveWorkbenchPetActivity", () => {
  it("按 waiting > failed > running > review > idle 派生动画", () => {
    const projects = [project("running", "/work/running")];
    expect(
      deriveWorkbenchPetActivity(
        projects,
        [task("running-task", "running", "执行构建")],
        createActivity([
          { attention: "completed", projectId: "review", taskId: "review-task" },
          { isRunning: true, projectId: "running", taskId: "running-task" },
          { attention: "failed", projectId: "failed", taskId: "failed-task" },
          { pending: 1, projectId: TEMPORARY_TASK_SCOPE_ID, taskId: "waiting-task" },
        ]),
      ).animationName,
    ).toBe("waiting");
    expect(deriveWorkbenchPetActivity([], [], createActivity([])).animationName).toBe("idle");
  });

  it("为同目录的每个活动 Task 生成独立气泡", () => {
    const result = deriveWorkbenchPetActivity(
      [project("first", "C:\\Work\\Codexly"), project("second", "c:/work/codexly/")],
      [task("task-1", "first", "实现宠物"), task("task-2", "second", "等待审批")],
      createActivity([
        { isRunning: true, projectId: "first", taskId: "task-1" },
        { isRunning: true, pending: 1, projectId: "second", taskId: "task-2" },
      ]),
    );

    expect(result.tasks).toEqual([
      {
        projectId: "first",
        rootPath: "C:\\Work\\Codexly",
        status: "running",
        taskId: "task-1",
        taskName: "实现宠物",
      },
      {
        projectId: "second",
        rootPath: "c:/work/codexly/",
        status: "waiting",
        taskId: "task-2",
        taskName: "等待审批",
      },
    ]);
  });

  it("在用户查看前保留后台已完成 Task 的完成气泡", () => {
    const result = deriveWorkbenchPetActivity(
      [project("project-1", "/work/project-1")],
      [task("task-1", "project-1", "完成后台构建")],
      createActivity([{ attention: "completed", projectId: "project-1", taskId: "task-1" }]),
    );

    expect(result.animationName).toBe("review");
    expect(result.tasks).toEqual([
      {
        projectId: "project-1",
        rootPath: "/work/project-1",
        status: "completed",
        taskId: "task-1",
        taskName: "完成后台构建",
      },
    ]);
  });

  it("临时任务影响动画但不创建任务气泡，失败 attention 也不保留气泡", () => {
    const result = deriveWorkbenchPetActivity(
      [project("failed", "/work/failed")],
      [],
      createActivity([
        { attention: "failed", projectId: "failed", taskId: "failed-task" },
        { isRunning: true, projectId: TEMPORARY_TASK_SCOPE_ID, taskId: "temporary-task" },
      ]),
    );
    expect(result.animationName).toBe("failed");
    expect(result.tasks).toEqual([]);
  });
});
