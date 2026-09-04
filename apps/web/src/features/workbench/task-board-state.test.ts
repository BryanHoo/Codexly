import { describe, expect, it } from "vitest";

import {
  recordRunningTaskActivity,
  reduceTaskActivityEvent,
} from "../conversation/runtime/task-activity.js";
import { groupTaskBoardTasks } from "./task-board-state.js";

describe("groupTaskBoardTasks", () => {
  it("聚合全部项目并支持按项目过滤", () => {
    let activity = recordRunningTaskActivity(new Map(), "project-a", "running-task");
    activity = recordRunningTaskActivity(activity, "project-b", "other-task");
    activity = reduceTaskActivityEvent(activity, "project-a", {
      itemId: "item-approval",
      payload: {
        request: {
          availableDecisions: ["allow", "deny"],
          command: "pnpm check",
          createdAt: "2026-09-02T08:00:00.000Z",
          cwd: "/workspace/Codexly",
          expiresAt: null,
          itemId: "item-approval",
          kind: "command",
          networkAccess: null,
          projectId: "project-a",
          reason: null,
          requestId: "approval-1",
          status: "pending",
          taskId: "approval-task",
          turnId: "turn-approval",
          type: "command_approval",
        },
      },
      provider: "codex",
      sequence: 1,
      sessionId: "runtime-1",
      taskId: "approval-task",
      timestamp: "2026-09-02T08:00:00.000Z",
      turnId: "turn-approval",
      type: "pending_request.created",
      version: 2,
    });

    expect(groupTaskBoardTasks(activity, null).running.map((task) => task.id)).toEqual([
      "running-task",
      "other-task",
    ]);
    expect(groupTaskBoardTasks(activity, null).approval.map((task) => task.id)).toEqual([
      "approval-task",
    ]);
    expect(groupTaskBoardTasks(activity, "project-a").running.map((task) => task.id)).toEqual([
      "running-task",
    ]);
  });
});
