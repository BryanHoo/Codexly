import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";
import type { TaskNotifier } from "../../notifications/browser-task-notifier.js";

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
    reason: "assistant_reply_started" | "native_notification" | "turn_completed",
  ) => void;
  taskNotifier?: TaskNotifier;
}>;

type BufferedProjectEvent = Readonly<{
  event: AgentEvent;
  retainedBytes: number;
}>;

export class ProjectEventHistory {
  #count = 0;
  #entries: (BufferedProjectEvent | undefined)[];
  #floorSequence = 0;
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  #retainedBytes = 0;
  #start = 0;

  public constructor(options: Readonly<{ maxBytes: number; maxEvents: number }>) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
      throw new RangeError("Project Event history maxBytes must be non-negative");
    }
    if (!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 0) {
      throw new RangeError("Project Event history maxEvents must be non-negative");
    }
    this.#maxBytes = options.maxBytes;
    this.#maxEvents = options.maxEvents;
    this.#entries = new Array<BufferedProjectEvent | undefined>(options.maxEvents);
  }

  public get floorSequence(): number {
    return this.#floorSequence;
  }

  public append(event: AgentEvent): void {
    const retainedBytes = estimateRetainedBytes(event);
    if (retainedBytes > this.#maxBytes || this.#maxEvents === 0) {
      this.reset(event.sequence);
      return;
    }
    if (this.#count === this.#maxEvents) {
      this.#evictOldest();
    }
    const insertionIndex = (this.#start + this.#count) % this.#maxEvents;
    this.#entries[insertionIndex] = { event, retainedBytes };
    this.#count += 1;
    this.#retainedBytes += retainedBytes;
    while (this.#retainedBytes > this.#maxBytes) {
      this.#evictOldest();
    }
  }

  public forEachAfter(sequence: number, visit: (event: AgentEvent) => void): void {
    for (let offset = 0; offset < this.#count; offset += 1) {
      const entry = this.#entries[(this.#start + offset) % this.#maxEvents];
      if (entry !== undefined && entry.event.sequence > sequence) {
        visit(entry.event);
      }
    }
  }

  public reset(floorSequence = this.#floorSequence): void {
    this.#entries = new Array<BufferedProjectEvent | undefined>(this.#maxEvents);
    this.#count = 0;
    this.#floorSequence = floorSequence;
    this.#retainedBytes = 0;
    this.#start = 0;
  }

  #evictOldest(): void {
    const oldestEntry = this.#entries[this.#start];
    if (oldestEntry === undefined) {
      return;
    }
    this.#entries[this.#start] = undefined;
    this.#start = (this.#start + 1) % this.#maxEvents;
    this.#count -= 1;
    this.#retainedBytes -= oldestEntry.retainedBytes;
    this.#floorSequence = oldestEntry.event.sequence;
  }
}

export function isDeltaEvent(event: AgentEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "plan.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

export function createProjectTaskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

export function createProjectTurnKey(projectId: string, taskId: string, turnId: string): string {
  return `${createProjectTaskKey(projectId, taskId)}\u0000${turnId}`;
}

// 每个 Task Store 独立合并动画帧内 Delta；Project Runtime 只共享传输和协议解析。
