import { getUtf8ByteLength } from "./byte-lru.js";
import type { TaskEventItem, TaskEventTurn, TaskStoreEvent } from "./task-event-model.js";

const rateWindowMs = 5_000;
const outputPauseMs = 3_000;
const sampleIntervalMs = 100;
const bytesPerToken = 4;

interface RateInterval {
  start: number;
  end: number;
  tokens: number;
}

class TokenRateSample {
  #sample: { count: number; at: number } | undefined;
  #lastGrowthAt: number | undefined;
  #lastCount: number | undefined;
  readonly #intervals: RateInterval[] = [];
  rate: number | null = null;
  measuredAt = -Infinity;

  observe(count: number, timestamp: number, estimated = false): void {
    if (
      this.#lastCount !== undefined &&
      (count < this.#lastCount || timestamp < (this.#lastGrowthAt ?? timestamp))
    ) {
      this.reset();
    }
    if (count === this.#lastCount) return;
    const lastGrowthAt = this.#lastGrowthAt;
    this.#lastCount = count;
    this.#lastGrowthAt = timestamp;
    const sample = this.#sample;
    if (
      sample === undefined ||
      (estimated && lastGrowthAt !== undefined && timestamp - lastGrowthAt >= outputPauseMs)
    ) {
      // 停顿期间保留当前读数。新一段输出单独建立基线，避免把等待混入平均值。
      this.#intervals.length = 0;
      this.#sample = { count, at: timestamp };
      return;
    }

    const elapsedMs = timestamp - sample.at;
    if (
      elapsedMs === 0 ||
      (elapsedMs < sampleIntervalMs && (estimated || this.#intervals.length > 0))
    ) {
      // 首批同刻或密集到达的数据只建立基线，之后的密集增量保留到下一次采样。
      if (this.#intervals.length === 0) sample.count = count;
      return;
    }

    // 只保留最近五秒的采样区间。窗口截断最老区间时按重叠时长分摊其 Token。
    const windowStart = timestamp - rateWindowMs;
    while (this.#intervals[0] && this.#intervals[0].end <= windowStart) this.#intervals.shift();
    this.#intervals.push({ start: sample.at, end: timestamp, tokens: count - sample.count });
    let tokens = 0;
    let durationMs = 0;
    for (const interval of this.#intervals) {
      const fullDurationMs = interval.end - interval.start;
      const includedMs = interval.end - Math.max(windowStart, interval.start);
      tokens += (interval.tokens * includedMs) / fullDurationMs;
      durationMs += includedMs;
    }
    this.rate = (tokens * 1_000) / durationMs;
    this.measuredAt = timestamp;
    this.#sample = { count, at: timestamp };
  }

  reset(): void {
    this.#sample = undefined;
    this.#lastCount = undefined;
    this.#lastGrowthAt = undefined;
    this.#intervals.length = 0;
    this.rate = null;
    this.measuredAt = -Infinity;
  }
}

/** 上报和文本各有独立的计数与时间窗口，避免切换数据来源时产生虚假增量。 */
class TurnOutputRate {
  #estimatedBytes = 0;
  #heldRate: number | null = null;
  readonly #estimated = new TokenRateSample();
  readonly #reported = new TokenRateSample();

  append(delta: string, timestamp: number): void {
    // 沿用 Codex 的 UTF-8 近似计数，只处理新增正文。
    this.#estimatedBytes += getUtf8ByteLength(delta);
    const tokens = Math.ceil(this.#estimatedBytes / bytesPerToken);
    this.#estimated.observe(tokens, timestamp, true);
  }

  report(count: number, timestamp: number): void {
    this.#reported.observe(count, timestamp);
  }

  pause(): void {
    this.#heldRate = this.read();
    this.#estimated.reset();
    this.#reported.reset();
  }

  read(): number | null {
    // 没有新正文时保留上一次读数。持续输出且上报落后一个窗口时改用文本估算。
    if (this.#reported.measuredAt >= this.#estimated.measuredAt - rateWindowMs) {
      return this.#reported.rate ?? this.#estimated.rate ?? this.#heldRate;
    }
    return this.#estimated.rate ?? this.#heldRate;
  }
}

/** 同一回合只用服务端事件的相对时间，因此客户端时钟偏差和批量投递不会拉长分母。 */
function sampleTimestamp(timestamp: string | undefined): number {
  const milliseconds = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

export class TurnOutputRates {
  readonly #rates = new Map<string, TurnOutputRate>();

  record(
    event: TaskStoreEvent<TaskEventItem>,
    turns: Readonly<Record<string, TaskEventTurn>>,
  ): void {
    if (event.type === "turn.completed") this.#rates.delete(event.turnId);
    if (
      event.type === "item.started" &&
      (event.payload.item.type === "tool" || event.payload.item.type === "command")
    ) {
      this.#rates.get(event.turnId)?.pause();
      return;
    }
    if (event.type === "usage.updated") {
      const { outputTokens } = event.payload;
      if (outputTokens !== undefined && turns[event.turnId]?.status === "running") {
        this.#rateFor(event.turnId).report(outputTokens, sampleTimestamp(event.timestamp));
      }
      return;
    }
    if (event.type !== "message.delta" && event.type !== "reasoning.delta") return;
    const { turnId, itemId, payload } = event;
    // 只计量前台模型输出，过滤用户回显、子会话和会话间消息。
    if (
      turns[turnId]?.status !== "running" ||
      typeof payload.delta !== "string" ||
      payload.delta.length === 0 ||
      itemId.startsWith("acp:message:user:") ||
      itemId.startsWith("acp:child:") ||
      itemId.startsWith("acp:delegation:")
    )
      return;

    this.#rateFor(turnId).append(payload.delta, sampleTimestamp(event.timestamp));
  }

  read(turnId: string): number | null {
    return this.#rates.get(turnId)?.read() ?? null;
  }

  clear(): void {
    this.#rates.clear();
  }

  retainRunning(turns: Readonly<Record<string, TaskEventTurn>>): void {
    for (const turnId of this.#rates.keys()) {
      if (turns[turnId]?.status !== "running") this.#rates.delete(turnId);
    }
  }

  #rateFor(turnId: string): TurnOutputRate {
    let rate = this.#rates.get(turnId);
    if (rate === undefined) {
      rate = new TurnOutputRate();
      this.#rates.set(turnId, rate);
    }
    return rate;
  }
}
