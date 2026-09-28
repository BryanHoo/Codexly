import type { AgentEvent, AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { ProjectEventHistory as SharedProjectEventHistory } from "@codexly/frontend-core";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
export { isDeltaEvent } from "@codexly/frontend-core";

export const PROJECT_RUNTIME_IDLE_TIMEOUT_MS = 2 * 60_000;
export const MAX_PROJECT_EVENT_HISTORY_BYTES = 4 * 1_048_576;
export const MAX_PROJECT_EVENT_HISTORY_EVENTS = 2_048;
export const MAX_TASK_TITLES = 2_048;
export const SNAPSHOT_RECOVERY_RETRY_INITIAL_MS = 1_000;
export const SNAPSHOT_RECOVERY_RETRY_MAX_MS = 30_000;

export type ActivityListener = () => void;
export type RecoverTaskSnapshot = () => Promise<AgentTaskSnapshotResponse | undefined>;
export type TaskRecoveryState = "disposed" | "ready" | "recovering" | "waiting_to_retry";

export type ProjectEventRuntimeOptions = Required<
  Pick<
    ProjectRuntimeManagerOptions,
    "idleTimeoutMs" | "maxEventHistoryBytes" | "maxEventHistoryEvents"
  >
>;

export type ProjectRuntimeManagerOptions = Readonly<{
  idleTimeoutMs?: number;
  maxEventHistoryBytes?: number;
  maxEventHistoryEvents?: number;
  onMcpServerStatusChanged?: (projectId: string, taskId: string) => void;
  onQueueChanged?: (projectId: string, taskId: string) => void;
  onSkillsChanged?: (projectId: string) => void;
  onTaskRemoved?: (projectId: string, taskId: string) => void;
  onProjectGitActivity?: (
    projectId: string,
    taskId: string,
    reason: "file_changed" | "turn_completed" | "turn_started",
  ) => void;
  onProjectGitMetadataChanged?: (projectId: string, rootPath: string) => void;
  onTaskMetadataChanged?: (
    projectId: string,
    taskId: string,
    reason: "assistant_reply_started" | "native_notification" | "turn_completed" | "turn_started",
    updatedAt?: string,
  ) => void;
}>;

export class ProjectEventHistory extends SharedProjectEventHistory<AgentEvent> {
  public constructor(options: Readonly<{ maxBytes: number; maxEvents: number }>) {
    super({ ...options, estimateBytes: estimateRetainedBytes });
  }
}

export function createProjectTaskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

export function createProjectTurnKey(projectId: string, taskId: string, turnId: string): string {
  return `${createProjectTaskKey(projectId, taskId)}\u0000${turnId}`;
}

// 每个 Task Store 独立合并动画帧内 Delta；Project Runtime 只共享传输和协议解析。
