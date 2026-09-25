import type { AgentEvent } from "@/protocol/index.js";
import { estimateRetainedBytes } from "@/shared/memory/byte-lru.js";
import { RingBuffer } from "@/shared/memory/ring-buffer.js";

export type ReplayGap = Pick<AgentEvent, "sequence" | "sessionId" | "taskId">;
const MAX_EVENTS = 1_024;
const MAX_BYTES = 4 * 1_048_576;
const IDLE_TIMEOUT_MS = 120_000;

interface Entry {
  checkpoint: ReplayGap;
  event: AgentEvent | undefined;
  bytes: number;
}

export class RuntimeEventHistory {
  readonly #entries = new RingBuffer<Entry>(MAX_EVENTS);
  readonly #payloads = new RingBuffer<Entry>(MAX_EVENTS);
  #bytes = 0;
  #lastAppendAt = 0;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  public get size(): number {
    return this.#entries.size;
  }

  public append(event: AgentEvent): void {
    const bytes = estimateRetainedBytes(event);
    const entry: Entry = {
      checkpoint: { sequence: event.sequence, sessionId: event.sessionId, taskId: event.taskId },
      event: bytes <= MAX_BYTES ? event : undefined,
      bytes: bytes <= MAX_BYTES ? bytes : 0,
    };
    const evicted = this.#entries.append(entry);
    if (evicted !== undefined) this.#releasePayload(evicted);
    this.#bytes += entry.bytes;
    if (entry.event !== undefined) {
      const evictedPayload = this.#payloads.append(entry);
      if (evictedPayload !== undefined) this.#releasePayload(evictedPayload);
    }
    while (this.#bytes > MAX_BYTES) {
      const oldest = this.#payloads.evictOldest();
      if (oldest === undefined) break;
      this.#releasePayload(oldest);
    }
    this.#lastAppendAt = Date.now();
    // 只维护一个空闲计时器，流式热路径不反复注册和取消计时器。
    if (this.#idleTimer === undefined) {
      this.#idleTimer = setTimeout(() => this.#expireIdlePayloads(), IDLE_TIMEOUT_MS);
    }
  }

  public replay(
    afterSequence: number,
    onEvent: (event: AgentEvent) => void,
    onGap?: (gap: ReplayGap) => void,
  ): void {
    this.#entries.forEach((entry) => {
      if (entry.checkpoint.sequence <= afterSequence) return;
      if (entry.event !== undefined) onEvent(entry.event);
      else onGap?.(entry.checkpoint);
    });
  }

  #releasePayload(entry: Entry): void {
    this.#bytes -= entry.bytes;
    entry.bytes = 0;
    // 保留轻量序号，避免最后一个大事件被淘汰后无法触发 Snapshot 恢复。
    entry.event = undefined;
  }

  #expireIdlePayloads(): void {
    const remaining = IDLE_TIMEOUT_MS - (Date.now() - this.#lastAppendAt);
    if (remaining > 0) {
      this.#idleTimer = setTimeout(() => this.#expireIdlePayloads(), remaining);
      return;
    }
    this.#payloads.forEach((entry) => this.#releasePayload(entry));
    this.#payloads.clear();
    this.#idleTimer = undefined;
  }
}
