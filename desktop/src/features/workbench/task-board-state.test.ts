import { describe, expect, it } from "vitest";

import { recordNativeTaskActivity } from "../conversation/runtime/task-activity.js";
import { groupTaskBoardTasks } from "./task-board-state.js";

describe("groupTaskBoardTasks", () => {
  it("默认聚合全部项目，并支持按项目过滤", () => {
    let activity = recordNativeTaskActivity(new Map(), {
      projectId: "project-a",
      requiresApproval: false,
      startedAt: "2026-09-02T08:00:00.000Z",
      status: "running",
      taskId: "running-task",
      taskName: "实现任务看板",
    });
    activity = recordNativeTaskActivity(activity, {
      projectId: "project-a",
      requiresApproval: true,
      startedAt: "2026-09-02T08:05:00.000Z",
      status: "waiting",
      taskId: "waiting-task",
      taskName: "确认权限",
    });
    activity = recordNativeTaskActivity(activity, {
      projectId: "project-a",
      requiresApproval: false,
      status: "completed",
      taskId: "completed-task",
      taskName: "已完成任务",
    });
    activity = recordNativeTaskActivity(activity, {
      projectId: "project-b",
      requiresApproval: false,
      startedAt: "2026-09-02T08:10:00.000Z",
      status: "running",
      taskId: "other-project-task",
      taskName: "其他项目任务",
    });

    const grouped = groupTaskBoardTasks(activity, null);

    expect(grouped.running.map((task) => task.id)).toEqual([
      "running-task",
      "other-project-task",
    ]);
    expect(grouped.approval.map((task) => task.id)).toEqual(["waiting-task"]);

    expect(grouped.running[0]).toMatchObject({
      id: "running-task",
      projectId: "project-a",
      startedAt: "2026-09-02T08:00:00.000Z",
      title: "实现任务看板",
    });

    const filtered = groupTaskBoardTasks(activity, "project-a");
    expect(filtered.running.map((task) => task.id)).toEqual(["running-task"]);
    expect(filtered.approval.map((task) => task.id)).toEqual(["waiting-task"]);
  });
});
