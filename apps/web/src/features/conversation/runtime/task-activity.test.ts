import type { AgentEvent, AgentTaskSnapshot, AgentTurn } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import {
  clearTaskAttention,
  getTaskActivity,
  listActiveTaskActivities,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  type TaskActivityMap,
} from "./task-activity.js";

const taskSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

function createSnapshot(
  taskId: string,
  status: AgentTaskSnapshot["status"],
  pendingRequests: AgentTaskSnapshot["pendingRequests"] = [],
): AgentTaskSnapshot {
  return {
    contextUsage: null,
    goal: null,
    plan: null,
    id: taskId,
    pendingRequests,
    pinned: false,
    projectId: "codexly",
    settings: taskSettings,
    status,
    title: taskId,
    turns: [],
    turnsNextCursor: null,
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}

function createTurnEvent(taskId: string, type: "turn.completed" | "turn.started"): AgentEvent {
  const eventEnvelope = {
    provider: "codex",
    sequence: type === "turn.started" ? 1 : 2,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-27T00:00:00.000Z",
    turnId: `turn-${taskId}`,
    version: 2,
  } as const;
  const turn = {
    completedAt: null,
    error: null,
    id: `turn-${taskId}`,
    items: [] as AgentTurn["items"],
    startedAt: "2026-07-27T00:00:00.000Z",
  };
  return type === "turn.started"
    ? { ...eventEnvelope, payload: { turn: { ...turn, status: "running" } }, type: "turn.started" }
    : {
        ...eventEnvelope,
        payload: {
          turn: {
            ...turn,
            completedAt: "2026-07-27T00:00:01.000Z",
            status: "completed",
          },
        },
        type: "turn.completed",
      };
}

function createTerminalTurnEvent(
  taskId: string,
  status: Extract<AgentTurn["status"], "failed" | "interrupted">,
): AgentEvent {
  const completedEvent = createTurnEvent(taskId, "turn.completed");
  if (completedEvent.type !== "turn.completed") {
    throw new Error("Expected a completed turn event");
  }
  return {
    ...completedEvent,
    payload: { turn: { ...completedEvent.payload.turn, status } },
  };
}

function createProviderErrorEvent(taskId: string, willRetry: boolean): AgentEvent {
  return {
    payload: { message: "模型服务不可用", willRetry },
    provider: "codex",
    sequence: 2,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-27T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "provider.error",
    version: 2,
  };
}

function createApprovalRequest(requestId: string): AgentTaskSnapshot["pendingRequests"][number] {
  return {
    availableDecisions: ["allow", "deny"],
    command: "pnpm check",
    createdAt: "2026-07-27T00:00:00.000Z",
    cwd: "/workspace/Codexly",
    expiresAt: null,
    itemId: `item-${requestId}`,
    kind: "command",
    networkAccess: null,
    projectId: "codexly",
    reason: null,
    requestId,
    status: "pending",
    taskId: "task-a",
    turnId: "turn-task-a",
    type: "command_approval",
  };
}

function createPermissionRequest(requestId: string): AgentTaskSnapshot["pendingRequests"][number] {
  return {
    createdAt: "2026-07-27T00:00:00.000Z",
    cwd: "/workspace/Codexly",
    environmentId: null,
    expiresAt: null,
    itemId: `item-${requestId}`,
    permissions: { fileSystem: null, network: { enabled: true } },
    projectId: "codexly",
    reason: null,
    requestId,
    status: "pending",
    taskId: "task-a",
    turnId: "turn-task-a",
    type: "permissions_approval",
  };
}

describe("task activity registry", () => {
  it("projects active tasks with stable board metadata", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, {
      ...createSnapshot("task-a", "running"),
      title: "实现任务看板",
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-task-a",
          items: [],
          startedAt: "2026-07-27T00:00:00.000Z",
          status: "running",
        },
      ],
    });
    activity = recordTaskActivitySnapshot(
      activity,
      createSnapshot("task-b", "running", [createApprovalRequest("approval-1")]),
    );

    expect(listActiveTaskActivities(activity)).toEqual([
      {
        id: "task-a",
        projectId: "codexly",
        startedAt: "2026-07-27T00:00:00.000Z",
        status: "running",
        title: "实现任务看板",
      },
      {
        id: "task-b",
        projectId: "codexly",
        status: "approval",
        title: "task-b",
      },
    ]);
  });

  it("keeps a running task visible when another task becomes active", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-b", "idle"));

    expect(getTaskActivity(activity, "codexly", "task-a").isRunning).toBe(true);
    expect(getTaskActivity(activity, "codexly", "task-b").isRunning).toBe(false);

    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTurnEvent("task-b", "turn.started"),
    );

    expect(getTaskActivity(activity, "codexly", "task-a").isRunning).toBe(true);
    expect(getTaskActivity(activity, "codexly", "task-b").isRunning).toBe(true);
  });

  it("clears only the task that receives a terminal event", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-b", "running"));

    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTurnEvent("task-a", "turn.completed"),
    );

    expect(getTaskActivity(activity, "codexly", "task-a").isRunning).toBe(false);
    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBe("completed");
    expect(getTaskActivity(activity, "codexly", "task-b").isRunning).toBe(true);
  });

  it("clears a completed reply marker when the task is viewed", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));
    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTurnEvent("task-a", "turn.completed"),
    );

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBe("completed");

    activity = clearTaskAttention(activity, "codexly", "task-a");

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBeNull();
  });

  it.each(["failed", "interrupted"] as const)(
    "marks an unviewed %s turn as an unfinished reply",
    (status) => {
      let activity: TaskActivityMap = new Map();
      activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));

      activity = reduceTaskActivityEvent(
        activity,
        "codexly",
        createTerminalTurnEvent("task-a", status),
      );

      expect(getTaskActivity(activity, "codexly", "task-a")).toEqual({
        attention: "failed",
        isAwaitingApproval: false,
        isRunning: false,
      });
    },
  );

  it("marks only a non-retrying provider error and clears it when a new turn starts", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"));

    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createProviderErrorEvent("task-a", true),
    );
    expect(getTaskActivity(activity, "codexly", "task-a")).toMatchObject({
      attention: null,
      isRunning: true,
    });

    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createProviderErrorEvent("task-a", false),
    );
    expect(getTaskActivity(activity, "codexly", "task-a")).toMatchObject({
      attention: "failed",
      isRunning: false,
    });

    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTurnEvent("task-a", "turn.started"),
    );
    expect(getTaskActivity(activity, "codexly", "task-a")).toMatchObject({
      attention: null,
      isRunning: true,
    });
  });

  it("preserves an unviewed failure marker across an idle snapshot", () => {
    let activity: TaskActivityMap = new Map();
    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTerminalTurnEvent("task-a", "interrupted"),
    );

    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "idle"));

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBe("failed");
  });

  it("does not mark an unrecoverable error on the task already being viewed", () => {
    const activity = reduceTaskActivityEvent(
      new Map(),
      "codexly",
      createProviderErrorEvent("task-a", false),
      true,
    );

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBeNull();
  });

  it("tracks multiple approval requests independently", () => {
    const firstRequest = createApprovalRequest("approval-1");
    const secondRequest = createApprovalRequest("approval-2");
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(
      activity,
      createSnapshot("task-a", "running", [firstRequest, secondRequest]),
    );

    const resolvedEvent = {
      itemId: firstRequest.itemId,
      payload: { request: { ...firstRequest, status: "resolved" } },
      provider: "codex",
      sequence: 3,
      sessionId: "runtime-1",
      taskId: "task-a",
      timestamp: "2026-07-27T00:00:01.000Z",
      turnId: firstRequest.turnId,
      type: "pending_request.resolved",
      version: 2,
    } as const satisfies AgentEvent;

    activity = reduceTaskActivityEvent(activity, "codexly", resolvedEvent);

    expect(getTaskActivity(activity, "codexly", "task-a").isAwaitingApproval).toBe(true);
    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBe("approval");
  });

  it("treats granular permission requests as approvals", () => {
    const activity = recordTaskActivitySnapshot(
      new Map(),
      createSnapshot("task-a", "running", [createPermissionRequest("permissions-1")]),
    );

    expect(getTaskActivity(activity, "codexly", "task-a")).toMatchObject({
      attention: "approval",
      isAwaitingApproval: true,
    });
  });

  it("clears a stale approval marker when the authoritative snapshot has no request", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(
      activity,
      createSnapshot("task-a", "running", [createApprovalRequest("approval-1")]),
    );

    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "idle"));

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBeNull();
    expect(getTaskActivity(activity, "codexly", "task-a").isAwaitingApproval).toBe(false);
  });

  it("does not create attention markers for a task that is already viewed", () => {
    let activity: TaskActivityMap = new Map();
    activity = recordTaskActivitySnapshot(activity, createSnapshot("task-a", "running"), true);
    activity = reduceTaskActivityEvent(
      activity,
      "codexly",
      createTurnEvent("task-a", "turn.completed"),
      true,
    );

    expect(getTaskActivity(activity, "codexly", "task-a").attention).toBeNull();
  });
});
