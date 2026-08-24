import type {
  AgentEvent,
  AgentTaskSnapshot,
  AgentTaskSnapshotResponse,
  AgentTurn,
} from "@codexly/protocol";
import { afterEach, vi, type Mock } from "vitest";
import type { CodexlyRuntimeClient } from "../../projects/project-queries.js";
import type { TaskNotifier } from "../../notifications/browser-task-notifier.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export const taskSettings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

export function createTurn(taskId: string, status: AgentTurn["status"] = "running"): AgentTurn {
  return {
    completedAt: status === "running" ? null : "2026-07-28T00:00:01.000Z",
    error: null,
    id: `turn-${taskId}`,
    items: [],
    startedAt: "2026-07-28T00:00:00.000Z",
    status,
  };
}

export function createSnapshotResponse(
  taskId: string,
  options: Readonly<{
    pendingRequests?: AgentTaskSnapshot["pendingRequests"];
    sequence?: number;
    sessionId?: string;
    status?: AgentTaskSnapshot["status"];
    title?: string;
  }> = {},
): AgentTaskSnapshotResponse {
  const status = options.status ?? "running";
  return {
    checkpoint: { sequence: options.sequence ?? 0, sessionId: options.sessionId ?? "runtime-1" },
    snapshot: {
      contextUsage: null,
      plan: null,
      id: taskId,
      pendingRequests: options.pendingRequests ?? [],
      pinned: false,
      projectId: "project-1",
      settings: taskSettings,
      status,
      title: options.title ?? taskId,
      turns: status === "running" ? [createTurn(taskId)] : [],
      turnsNextCursor: null,
      updatedAt: "2026-07-28T00:00:00.000Z",
    },
  };
}

export function createTurnCompletedEvent(
  taskId: string,
  sequence: number,
  status: Extract<AgentTurn["status"], "completed" | "failed" | "interrupted"> = "completed",
): AgentEvent {
  return {
    payload: { turn: createTurn(taskId, status) },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "turn.completed",
    version: 2,
  };
}

export function createTurnStartedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    payload: { turn: createTurn(taskId) },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "turn.started",
    version: 2,
  };
}

export function createProjectGitMetadataChangedEvent(
  rootPath: string,
  sequence: number,
): AgentEvent {
  return {
    payload: { rootPath },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId: "project-1",
    timestamp: "2026-07-28T00:00:01.000Z",
    type: "project.git_metadata_changed",
    version: 2,
  };
}

export function createMessageDeltaEvent(
  taskId: string,
  sequence: number,
  delta: string,
): AgentEvent {
  return {
    itemId: `message-${taskId}`,
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "message.delta",
    version: 2,
  };
}

export function createFileChangeCompletedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    itemId: `file-change-${taskId}`,
    payload: {
      item: {
        changes: [{ diff: "+changed", kind: "update", path: "src/app.ts" }],
        id: `file-change-${taskId}`,
        status: "completed",
        type: "file_change",
      },
    },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    turnId: `turn-${taskId}`,
    type: "item.completed",
    version: 2,
  };
}

export function createMcpServerStatusUpdatedEvent(taskId: string, sequence: number): AgentEvent {
  return {
    payload: {
      error: null,
      failureReason: null,
      name: "context7",
      status: "ready",
    },
    provider: "codex",
    sequence,
    sessionId: "runtime-1",
    taskId,
    timestamp: "2026-07-28T00:00:01.000Z",
    type: "mcp_server.status_updated",
    version: 2,
  };
}

type ClientHarness = Readonly<{
  client: Readonly<{
    readTask: Mock<CodexlyRuntimeClient["readTask"]>;
    subscribeEvents: Mock<CodexlyRuntimeClient["subscribeEvents"]>;
    unsubscribeTask: Mock<CodexlyRuntimeClient["unsubscribeTask"]>;
  }>;
  closeConnection: Mock<() => void>;
  connectionError: (error: Error) => void;
  connectionState: (
    state: Parameters<
      NonNullable<Parameters<CodexlyRuntimeClient["subscribeEvents"]>[0]["onConnectionState"]>
    >[0],
  ) => void;
  emit: (event: AgentEvent) => void;
  requireResync: () => void;
}>;

export function createClientHarness(): ClientHarness {
  let subscription: Parameters<CodexlyRuntimeClient["subscribeEvents"]>[0] | undefined;
  const closeConnection = vi.fn();
  const client = {
    readTask: vi.fn<CodexlyRuntimeClient["readTask"]>(),
    subscribeEvents: vi.fn<CodexlyRuntimeClient["subscribeEvents"]>((options) => {
      subscription = options;
      return closeConnection;
    }),
    unsubscribeTask: vi.fn<CodexlyRuntimeClient["unsubscribeTask"]>((_, taskId) =>
      Promise.resolve({
        status: "unsubscribed",
        taskId,
      }),
    ),
  } satisfies CodexlyRuntimeClient;

  return {
    client,
    closeConnection,
    connectionState(
      state: Parameters<
        NonNullable<Parameters<CodexlyRuntimeClient["subscribeEvents"]>[0]["onConnectionState"]>
      >[0],
    ) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      const onConnectionState = subscription.onConnectionState;
      if (onConnectionState === undefined) {
        throw new Error("Project event subscription does not observe connection state");
      }
      onConnectionState(state);
    },
    connectionError(error: Error) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onError?.(error);
    },
    emit(event: AgentEvent) {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onEvent(event);
    },
    requireResync() {
      if (subscription === undefined) {
        throw new Error("Project event subscription has not started");
      }
      subscription.onResyncRequired({
        latestSequence: 8,
        reason: "event_retention_exceeded",
        sessionId: "runtime-1",
        type: "resync.required",
        version: 3,
      });
    },
  };
}

export function createTaskNotifier() {
  return {
    notify: vi.fn<TaskNotifier["notify"]>(),
    requestPermission: vi.fn<TaskNotifier["requestPermission"]>(() => Promise.resolve()),
  } satisfies TaskNotifier;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
