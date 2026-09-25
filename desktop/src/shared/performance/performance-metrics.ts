const MAX_SAMPLES = 2_048;
const IPC_RATE_WINDOW_MS = 1_000;

export const PERFORMANCE_MONITORING_ENABLED =
  typeof window !== "undefined" &&
  (import.meta.env.DEV ||
    new URLSearchParams(window.location.search).get("performance-profile") === "1");

export type DistributionSummary = Readonly<{
  count: number;
  max: number;
  p50: number;
  p95: number;
}>;

export type PerformanceSnapshot = Readonly<{
  deltaToReactCommitMs: DistributionSummary;
  ipc: Readonly<{
    eventsPerSecond: number;
    mergeRate: number;
    queueHighWatermark: number;
  }>;
  longTaskMs: DistributionSummary;
  reactActualDurationMs: DistributionSummary;
}>;

function summarize(values: readonly number[]): DistributionSummary {
  if (values.length === 0) return { count: 0, max: 0, p50: 0, p95: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  const percentile = (ratio: number) =>
    ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
  return {
    count: ordered.length,
    max: ordered.at(-1) ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

function appendBounded(values: number[], value: number): void {
  values.push(value);
  if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
}

export class PerformanceMetrics {
  readonly #deltaReceivedAtBySequence = new Map<string, number>();
  readonly #deltaToCommitMs: number[] = [];
  readonly #ipcEventTimes: number[] = [];
  readonly #longTaskMs: number[] = [];
  readonly #reactActualDurationMs: number[] = [];
  #ipcInputEvents = 0;
  #ipcOutputEvents = 0;
  #queueHighWatermark = 0;

  public recordDeltaReceived(eventKey: string, receivedAtUnixMs: number): void {
    this.#deltaReceivedAtBySequence.set(eventKey, receivedAtUnixMs);
    if (this.#deltaReceivedAtBySequence.size > MAX_SAMPLES) {
      const oldest = this.#deltaReceivedAtBySequence.keys().next().value;
      if (oldest !== undefined) this.#deltaReceivedAtBySequence.delete(oldest);
    }
  }

  public recordIpcEvent(queueDepth: number, nowMs: number): void {
    appendBounded(this.#ipcEventTimes, nowMs);
    this.#queueHighWatermark = Math.max(this.#queueHighWatermark, queueDepth);
  }

  public recordIpcMerge(inputEvents: number, outputEvents: number): void {
    this.#ipcInputEvents += inputEvents;
    this.#ipcOutputEvents += outputEvents;
  }

  public recordLongTask(durationMs: number): void {
    appendBounded(this.#longTaskMs, durationMs);
  }

  public recordReactCommit(actualDurationMs: number, commitUnixMs: number): void {
    appendBounded(this.#reactActualDurationMs, actualDurationMs);
    for (const receivedAtUnixMs of this.#deltaReceivedAtBySequence.values()) {
      appendBounded(this.#deltaToCommitMs, Math.max(0, commitUnixMs - receivedAtUnixMs));
    }
    this.#deltaReceivedAtBySequence.clear();
  }

  public snapshot(nowMs: number): PerformanceSnapshot {
    const rateStart = nowMs - IPC_RATE_WINDOW_MS;
    while ((this.#ipcEventTimes[0] ?? Number.POSITIVE_INFINITY) < rateStart) {
      this.#ipcEventTimes.shift();
    }
    const mergedEvents = Math.max(0, this.#ipcInputEvents - this.#ipcOutputEvents);
    return {
      deltaToReactCommitMs: summarize(this.#deltaToCommitMs),
      ipc: {
        eventsPerSecond: this.#ipcEventTimes.length,
        mergeRate: this.#ipcInputEvents === 0 ? 0 : mergedEvents / this.#ipcInputEvents,
        queueHighWatermark: this.#queueHighWatermark,
      },
      longTaskMs: summarize(this.#longTaskMs),
      reactActualDurationMs: summarize(this.#reactActualDurationMs),
    };
  }
}

export const applicationPerformanceMetrics = new PerformanceMetrics();
