import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("./native-invoke.js", () => ({ invoke }));

describe("task activity client", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reads and acknowledges Rust-owned task activity", async () => {
    const snapshot = [
      {
        projectId: "project-1",
        status: "completed",
        taskId: "task-1",
        taskName: "任务",
      },
    ];
    invoke.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(undefined);
    const { acknowledgeTaskActivity, getTaskActivities } = await import(
      "./task-activity-client.js"
    );

    await expect(getTaskActivities()).resolves.toEqual(snapshot);
    await expect(acknowledgeTaskActivity("project-1", "task-1")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "get_task_activities");
    expect(invoke).toHaveBeenNthCalledWith(2, "acknowledge_task_activity", {
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("批量解除指定任务的问题等待，不使用普通聚焦确认参数", async () => {
    invoke.mockResolvedValue(undefined);
    const { resolveAsyncQuestionActivities } = await import("./task-activity-client.js");
    await resolveAsyncQuestionActivities("project-a", "task-a", ["question-a", "question-b"]);
    expect(invoke).toHaveBeenCalledWith("acknowledge_task_activity", {
      projectId: "project-a", taskId: "task-a", asyncQuestionIds: ["question-a", "question-b"],
    });
  });
});
