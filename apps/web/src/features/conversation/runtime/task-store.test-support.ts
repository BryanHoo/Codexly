import type { AgentTaskSnapshotResponse, PendingRequest } from "@codexly/protocol";
import { type createTaskStore, createTaskItemKey } from "./task-store.js";

// 集中维护 task store 的快照、事件和 pending request 样本。
export const timestamp = "2026-07-28T00:00:00.000Z";

export const runningItemKey = (itemId: string) => createTaskItemKey("turn-running", itemId);

export function readTurnItemIds(
  store: ReturnType<typeof createTaskStore>,
  turnId: string,
): readonly (string | undefined)[] {
  const state = store.getState();
  return (state.itemKeysByTurnId[turnId] ?? []).map((itemKey) => state.getItemByKey(itemKey)?.id);
}

export function createResponse(
  overrides: Partial<AgentTaskSnapshotResponse["snapshot"]> = {},
): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 10, sessionId: "session-1" },
    snapshot: {
      contextUsage: null,
      goal: null,
      id: "task-1",
      plan: null,
      pendingRequests: [],
      pinned: false,
      projectId: "project-1",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "running",
      title: "归一化运行时",
      turns: [
        {
          completedAt: timestamp,
          error: null,
          id: "turn-completed",
          items: [
            {
              id: "message-completed",
              role: "assistant",
              text: "已完成",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "completed",
        },
        {
          completedAt: null,
          error: null,
          id: "turn-running",
          items: [
            {
              id: "message-running",
              role: "assistant",
              text: "开始",
              type: "message",
            },
          ],
          startedAt: timestamp,
          status: "running",
        },
      ],
      turnsNextCursor: null,
      updatedAt: timestamp,
      ...overrides,
    },
  };
}

export function eventEnvelope(sequence: number) {
  return {
    provider: "codex",
    sequence,
    sessionId: "session-1",
    taskId: "task-1",
    timestamp: "2026-07-28T00:00:01.000Z",
    version: 2,
  } as const;
}

export function createPendingRequest<Status extends PendingRequest["status"] = "pending">(
  status: Status = "pending" as Status,
): PendingRequest & Readonly<{ status: Status }> {
  return {
    availableDecisions: ["allow", "deny"],
    command: "pnpm test",
    createdAt: timestamp,
    cwd: "/workspace",
    expiresAt: null,
    itemId: "command-1",
    kind: "command",
    networkAccess: null,
    projectId: "project-1",
    reason: null,
    requestId: "request-1",
    status,
    taskId: "task-1",
    turnId: "turn-running",
    type: "command_approval",
  };
}
