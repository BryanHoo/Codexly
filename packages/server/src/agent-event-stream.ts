import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentEvent, EventCheckpoint } from "@code-agent/protocol";
import { getSerializedAgentEventByteLength } from "./event-socket-sender.js";

type AgentEventListener = (event: AgentEvent) => void;
type AppendEventType = "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta";
type ReplaceEventType = "file_change.updated" | "tool.progress";
type CoalescedEventType = AppendEventType | ReplaceEventType;
type CoalescedProviderEvent = Extract<AgentProviderEvent, Readonly<{ type: CoalescedEventType }>>;
type RetainedAgentEvent = Readonly<{ event: AgentEvent; retainedBytes: number }>;

export type AgentEventReplay =
  | Readonly<{ events: readonly AgentEvent[]; type: "events" }>
  | Readonly<{
      latestSequence: number;
      reason: "event_retention_exceeded" | "session_changed";
      type: "resync";
    }>;

export interface AgentEventStreamMetrics {
  backpressureSignals: number;
  coalescedEvents: number;
  pendingDeltas: number;
  providerEventsReceived: number;
  publishedEvents: number;
  retainedEvents: number;
  retentionEvictions: number;
}

export interface AgentEventStreamOptions {
  capacity?: number;
  coalescingWindowMs?: number;
  maxEventBytes?: number;
  maxRetainedBytes?: number;
  now?: () => Date;
  pressureCoalescingWindowMs?: number;
  provider: string;
  sessionId: string;
}

const DEFAULT_COALESCING_WINDOW_MS = 16;
const DEFAULT_MAX_EVENT_BYTES = 1_048_576;
const DEFAULT_MAX_RETAINED_BYTES = 4 * 1_048_576;
const DEFAULT_PRESSURE_COALESCING_WINDOW_MS = 32;

function isCoalescedEvent(event: AgentProviderEvent): event is CoalescedProviderEvent {
  return (
    event.type === "command.output_delta" ||
    event.type === "file_change.updated" ||
    event.type === "message.delta" ||
    event.type === "plan.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "tool.progress"
  );
}

function coalescingKey(event: CoalescedProviderEvent): string {
  const field =
    event.type === "reasoning.delta"
      ? `${event.payload.field}:${String(event.payload.sectionIndex ?? -1)}`
      : "value";
  return JSON.stringify([event.taskId, event.turnId, event.itemId, event.type, field]);
}

function mergeCoalescedEvent(
  left: CoalescedProviderEvent,
  right: CoalescedProviderEvent,
): CoalescedProviderEvent {
  if (
    (left.type === "command.output_delta" && right.type === "command.output_delta") ||
    (left.type === "message.delta" && right.type === "message.delta") ||
    (left.type === "plan.delta" && right.type === "plan.delta") ||
    (left.type === "reasoning.delta" && right.type === "reasoning.delta")
  ) {
    return {
      ...left,
      payload: { ...left.payload, delta: left.payload.delta + right.payload.delta },
    } as CoalescedProviderEvent;
  }
  // 进度和文件集合都是状态快照，只保留窗口内的最新值。
  return right;
}

export class AgentEventStream {
  readonly #capacity: number;
  readonly #coalescingWindowMs: number;
  readonly #events: (RetainedAgentEvent | undefined)[];
  readonly #listeners = new Set<AgentEventListener>();
  readonly #maxEventBytes: number;
  readonly #maxRetainedBytes: number;
  readonly #now: () => Date;
  readonly #pendingDeltas: CoalescedProviderEvent[] = [];
  readonly #pressureCoalescingWindowMs: number;
  readonly #provider: string;
  readonly #sessionId: string;
  #backpressureSignals = 0;
  #closed = false;
  #coalescedEvents = 0;
  #eventCount = 0;
  #eventStart = 0;
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #historyFloorSequence = 0;
  #providerEventsReceived = 0;
  #publishedEvents = 0;
  #retainedBytes = 0;
  #retentionEvictions = 0;
  #sequence = 0;
  #usePressureWindow = false;

  public constructor(options: AgentEventStreamOptions) {
    const capacity = options.capacity ?? 1_000;
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Agent Event capacity must be a positive integer");
    }
    const coalescingWindowMs = options.coalescingWindowMs ?? DEFAULT_COALESCING_WINDOW_MS;
    const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
    const maxRetainedBytes = options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
    const pressureCoalescingWindowMs =
      options.pressureCoalescingWindowMs ?? DEFAULT_PRESSURE_COALESCING_WINDOW_MS;
    if (!Number.isFinite(coalescingWindowMs) || coalescingWindowMs <= 0) {
      throw new RangeError("Agent Event coalescing window must be a positive number");
    }
    if (
      !Number.isFinite(pressureCoalescingWindowMs) ||
      pressureCoalescingWindowMs < coalescingWindowMs
    ) {
      throw new RangeError(
        "Agent Event pressure coalescing window must not be shorter than the normal window",
      );
    }
    if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 0) {
      throw new RangeError("Agent Event maxEventBytes must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 0) {
      throw new RangeError("Agent Event maxRetainedBytes must be a non-negative safe integer");
    }
    this.#capacity = capacity;
    this.#coalescingWindowMs = coalescingWindowMs;
    this.#events = new Array<RetainedAgentEvent | undefined>(capacity);
    this.#maxEventBytes = maxEventBytes;
    this.#maxRetainedBytes = maxRetainedBytes;
    this.#now = options.now ?? (() => new Date());
    this.#pressureCoalescingWindowMs = pressureCoalescingWindowMs;
    this.#provider = options.provider;
    this.#sessionId = options.sessionId;
  }

  public get checkpoint(): EventCheckpoint {
    // Snapshot checkpoint 必须覆盖此前已收到但尚未分配 Sequence 的 Delta。
    this.#flush();
    return { sequence: this.#sequence, sessionId: this.#sessionId };
  }

  public get metrics(): Readonly<AgentEventStreamMetrics> {
    return {
      backpressureSignals: this.#backpressureSignals,
      coalescedEvents: this.#coalescedEvents,
      pendingDeltas: this.#pendingDeltas.length,
      providerEventsReceived: this.#providerEventsReceived,
      publishedEvents: this.#publishedEvents,
      retainedEvents: this.#eventCount,
      retentionEvictions: this.#retentionEvictions,
    };
  }

  public publish(event: AgentProviderEvent): void {
    if (this.#closed) {
      return;
    }
    this.#providerEventsReceived += 1;
    if (!isCoalescedEvent(event)) {
      // 关键状态必须排在所有更早 Delta 之后，不能等待定时窗口。
      this.#flush();
      this.#publishNow(event);
      return;
    }

    if (this.#flushTimer === undefined) {
      // 每个批次的首个 Delta 直接交付，窗口只合并随后到达的高频事件。
      this.#publishNow(event);
      this.#scheduleFlush();
      return;
    }

    const previousIndex = this.#pendingDeltas.length - 1;
    const previous = this.#pendingDeltas[previousIndex];
    if (previous === undefined || coalescingKey(previous) !== coalescingKey(event)) {
      this.#pendingDeltas.push(event);
    } else {
      // 只合并队尾的同 Key Delta，保留 A-B-A 交错事件的原始顺序。
      this.#pendingDeltas[previousIndex] = mergeCoalescedEvent(previous, event);
      this.#coalescedEvents += 1;
    }
  }

  public noteBackpressure(): void {
    if (this.#closed) {
      return;
    }
    this.#backpressureSignals += 1;
    this.#usePressureWindow = true;
  }

  public replayAfter(sequence: number): AgentEventReplay {
    this.#flush();
    if (sequence > this.#sequence) {
      return { latestSequence: this.#sequence, reason: "session_changed", type: "resync" };
    }
    const retained = this.#retainedEvents();
    if (sequence < this.#historyFloorSequence) {
      return {
        latestSequence: this.#sequence,
        reason: "event_retention_exceeded",
        type: "resync",
      };
    }
    return { events: retained.filter((event) => event.sequence > sequence), type: "events" };
  }

  public subscribe(listener: AgentEventListener): () => void {
    if (this.#closed) {
      return () => undefined;
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#flush();
    this.#closed = true;
    this.#listeners.clear();
  }

  #flush(): void {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    if (this.#pendingDeltas.length === 0) {
      return;
    }
    const pending = this.#pendingDeltas.splice(0);
    for (const event of pending) {
      this.#publishNow(event);
    }
  }

  #publishNow(event: AgentProviderEvent): void {
    this.#sequence += 1;
    const published = {
      ...event,
      provider: this.#provider,
      sequence: this.#sequence,
      sessionId: this.#sessionId,
      timestamp: this.#now().toISOString(),
      version: 2 as const,
    } as AgentEvent;
    this.#retain(published);
    this.#publishedEvents += 1;
    for (const listener of this.#listeners) {
      listener(published);
    }
  }

  #retain(event: AgentEvent): void {
    const retainedBytes = getSerializedAgentEventByteLength(event);
    if (retainedBytes > this.#maxEventBytes || retainedBytes > this.#maxRetainedBytes) {
      // 单事件无法安全保留时清空不可连续回放的旧窗口，旧 Checkpoint 必须重读 Snapshot。
      while (this.#eventCount > 0) {
        this.#evictOldest();
      }
      this.#historyFloorSequence = event.sequence;
      this.#retentionEvictions += 1;
      return;
    }
    if (this.#eventCount === this.#capacity) {
      this.#evictOldest();
    }
    while (this.#eventCount > 0 && this.#retainedBytes + retainedBytes > this.#maxRetainedBytes) {
      this.#evictOldest();
    }
    const insertionIndex = (this.#eventStart + this.#eventCount) % this.#capacity;
    this.#events[insertionIndex] = { event, retainedBytes };
    this.#eventCount += 1;
    this.#retainedBytes += retainedBytes;
  }

  #retainedEvents(): AgentEvent[] {
    const retained: AgentEvent[] = [];
    for (let offset = 0; offset < this.#eventCount; offset += 1) {
      const entry = this.#events[(this.#eventStart + offset) % this.#capacity];
      if (entry !== undefined) {
        retained.push(entry.event);
      }
    }
    return retained;
  }

  #evictOldest(): void {
    const oldest = this.#events[this.#eventStart];
    if (oldest === undefined) {
      return;
    }
    this.#events[this.#eventStart] = undefined;
    this.#eventStart = (this.#eventStart + 1) % this.#capacity;
    this.#eventCount -= 1;
    this.#retainedBytes -= oldest.retainedBytes;
    this.#historyFloorSequence = oldest.event.sequence;
    this.#retentionEvictions += 1;
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined) {
      return;
    }
    const delay = this.#usePressureWindow
      ? this.#pressureCoalescingWindowMs
      : this.#coalescingWindowMs;
    this.#usePressureWindow = false;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.#flush();
    }, delay);
  }
}
