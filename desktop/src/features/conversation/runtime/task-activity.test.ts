import { describe, expect, it } from "vitest";

import type { AgentEvent, AgentTaskSnapshot, TaskActivitySnapshot } from "@/protocol/index.js";
import {
  clearTaskAttention,
  recordNativeTaskActivity,
  recordRunningTaskActivity,
  recordTaskActivitySnapshot,
  reduceTaskActivityEvent,
  restoreNativeTaskActivity,
  type TaskActivityMap,
} from "./task-activity.js";

const key = "codexly\u0000task-a";
const timestamp = "2026-07-27T00:00:00.000Z";

function createSnapshot(): AgentTaskSnapshot {
  return {
    contextUsage: null,
    goal: null,
    plan: null,
    id: "task-a",
    pendingRequests: [],
    pinned: false,
    projectId: "codexly",
    settings: {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    },
    status: "running",
    title: "task-a",
    turns: [],
    turnsNextCursor: null,
    updatedAt: timestamp,
  };
}

const startedEvent = {
  provider: "codex",
  sequence: 1,
  sessionId: "runtime-1",
  taskId: "task-a",
  timestamp,
  turnId: "turn-task-a",
  version: 2,
  type: "turn.started",
  payload: {
    turn: {
      completedAt: null,
      error: null,
      id: "turn-task-a",
      items: [],
      startedAt: timestamp,
      status: "running",
    },
  },
} as const satisfies AgentEvent;

const nativeSnapshot: TaskActivitySnapshot = {
  projectId: "codexly",
  taskId: "task-a",
  taskName: "task-a",
  requiresApproval: false,
  startedAt: timestamp,
  status: "running",
};

describe("task activity engine metadata", () => {
  it("propagates Claude snapshots and preserves the engine through event and status updates", () => {
    let activity = recordTaskActivitySnapshot(new Map(), { ...createSnapshot(), engine: "claude" });
    expect(activity.get(key)?.engine).toBe("claude");
    activity = recordRunningTaskActivity(activity, "codexly", "task-a");
    expect(activity.get(key)?.engine).toBe("claude");
    const events: AgentEvent[] = [
      startedEvent,
      { ...startedEvent, type: "task.status_updated", payload: { status: "idle" } },
      {
        ...startedEvent,
        type: "turn.completed",
        payload: { turn: { ...startedEvent.payload.turn, completedAt: timestamp, status: "completed" } },
      },
    ];
    for (const event of events) {
      activity = reduceTaskActivityEvent(activity, "codexly", event);
      expect(activity.get(key)?.engine).toBe("claude");
    }
    activity = clearTaskAttention(activity, "codexly", "task-a");
    expect(activity.get(key)?.engine).toBe("claude");
  });

  it("defaults only complete legacy snapshots to Codex and reuses unchanged maps", () => {
    const snapshot = createSnapshot();
    const activity = recordTaskActivitySnapshot(new Map(), snapshot);
    expect(activity.get(key)?.engine).toBe("codex");
    expect(recordTaskActivitySnapshot(activity, snapshot)).toBe(activity);
  });

  it("keeps event-first tasks unknown and updates the map when only engine metadata arrives", () => {
    const activity = reduceTaskActivityEvent(new Map(), "codexly", startedEvent);
    expect(activity.get(key)?.engine).toBeUndefined();
    expect(reduceTaskActivityEvent(activity, "codexly", startedEvent)).toBe(activity);
    expect(recordRunningTaskActivity(activity, "codexly", "task-a")).toBe(activity);
    expect(recordRunningTaskActivity(new Map(), "codexly", "task-a").get(key)?.engine).toBeUndefined();

    const snapshot = { ...createSnapshot(), engine: "claude" as const };
    const updated = recordTaskActivitySnapshot(activity, snapshot);
    expect(updated).not.toBe(activity);
    expect(updated.get(key)).toEqual({ ...activity.get(key), engine: "claude" });
    expect(recordTaskActivitySnapshot(updated, snapshot)).toBe(updated);
  });

  it.each(["running", "waiting", "completed", "failed"] as const)(
    "preserves a known engine when native activity becomes %s",
    (status) => {
      const current = recordTaskActivitySnapshot(new Map(), { ...createSnapshot(), engine: "claude" });
      const snapshot = { ...nativeSnapshot, status, requiresApproval: status === "waiting" };
      const activity = recordNativeTaskActivity(current, snapshot);
      expect(activity.get(key)?.engine).toBe("claude");
      expect(recordNativeTaskActivity(activity, snapshot)).toBe(activity);
    },
  );

  it("keeps native-only activity unknown until full metadata arrives", () => {
    const activity = restoreNativeTaskActivity(new Map(), nativeSnapshot);
    expect(activity.get(key)?.engine).toBeUndefined();
    expect(recordNativeTaskActivity(activity, nativeSnapshot)).toBe(activity);
    const updated = recordTaskActivitySnapshot(activity, { ...createSnapshot(), engine: "claude" });
    expect(updated).not.toBe(activity);
    expect(updated.get(key)).toEqual({ ...activity.get(key), engine: "claude" });
    expect(restoreNativeTaskActivity(updated, { ...nativeSnapshot, status: "completed" })).toBe(updated);
  });

  it("preserves known engines and map identity during native restore", () => {
    const activity: TaskActivityMap = recordTaskActivitySnapshot(new Map(), {
      ...createSnapshot(),
      engine: "claude",
    });
    expect(restoreNativeTaskActivity(activity, nativeSnapshot)).toBe(activity);
  });
});
