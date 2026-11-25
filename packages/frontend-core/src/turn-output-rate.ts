import { getUtf8ByteLength } from "./byte-lru.js";
import type { TaskEventTurn, TaskStoreEvent } from "./task-event-model.js";

const sampleIntervalMs = 1_000;
const outputPauseMs = 3_000;
const startupBurstMs = 100;
const bytesPerToken = 4;

class TokenRateSample {
  #baseline: { count: number; at: number } | undefined;
  #lastCount = 0;
  #lastGrowthAt: number | undefined;
  rate: number | null = null;

  observe(count: number, timestamp: number, estimated = false): void {
    const baseline = this.#baseline;
    const reset = count < this.#lastCount || (baseline !== undefined && timestamp < baseline.at);
    if (count === this.#lastCount && baseline !== undefined && !reset) return;
    this.#lastCount = count;
    if (reset) {
      this.rate = null;
      this.#lastGrowthAt = undefined;
    }
    const lastGrowthAt = this.#lastGrowthAt;
    this.#lastGrowthAt = timestamp;
    if (
      baseline === undefined ||
      reset ||
      (estimated && lastGrowthAt !== undefined && timestamp - lastGrowthAt >= outputPauseMs)
    ) {
      // 上一段生成的速度继续显示，恢复后的采样区间从新一段正文开始。
      this.#baseline = { count, at: timestamp };
      return;
    }

    // 累计不足一秒的增长留给下一次采样，避免同一批到达的增量瞬间推高读数。
    // 相同计数不推进采样时间，工具执行或等待期间继续显示最近一次有效读数。
    const elapsedMs = timestamp - baseline.at;
    if (estimated && this.rate === null && elapsedMs < startupBurstMs) {
      // 首批缓冲内容没有生成起点，合并进初始基线，避免把集中到达算成瞬时生成。
      baseline.count = count;
    }
    if (elapsedMs < sampleIntervalMs) return;
    this.rate = ((count - baseline.count) * 1_000) / elapsedMs;
    this.#baseline = { count, at: timestamp };
  }
}

/** 每个回合独立保留两类累计样本，切换数据来源时只切换已算出的读数。 */
class TurnOutputRate {
  #estimatedBytes = 0;
  readonly #estimated = new TokenRateSample();
  readonly #reported = new TokenRateSample();

  append(delta: string, timestamp: number): void {
    // Codex 的近似计数采用 UTF-8 字节，每次只处理新增正文。
    this.#estimatedBytes += getUtf8ByteLength(delta);
    this.#estimated.observe(this.#estimatedTokens, timestamp, true);
  }

  report(count: number, receivedAt: number): void {
    this.#reported.observe(count, receivedAt);
  }

  read(): number | null {
    const sampledRate = this.#reported.rate ?? this.#estimated.rate;
    if (sampledRate !== null || this.#estimatedBytes === 0) return sampledRate;
    // 首批文本以一秒为估算窗口，短回复或合并推送也能在首个增长样本前显示速度。
    return (this.#estimatedTokens * 1_000) / sampleIntervalMs;
  }

  get #estimatedTokens(): number {
    return Math.ceil(this.#estimatedBytes / bytesPerToken);
  }
}

/** 同一回合只用服务端事件的相对时间，因此客户端时钟偏差和批量投递不会拉长分母。 */
function sampleTimestamp(timestamp: string | undefined): number {
  const milliseconds = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

export class TurnOutputRates {
  readonly #rates = new Map<string, TurnOutputRate>();

  record(event: TaskStoreEvent<unknown>, turns: Readonly<Record<string, TaskEventTurn>>): void {
    if (event.type === "turn.completed") this.#rates.delete(event.turnId);
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
