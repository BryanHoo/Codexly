import { getUtf8ByteLength } from "./byte-lru.js";
import type { TaskEventTurn, TaskStoreEvent } from "./task-event-model.js";

const windowMs = 3_000;
const bucketMs = 250;

/** 只保留最近三秒的文本计数和最新上报样本，无需保留或重扫正文。 */
class TurnOutputRate {
  readonly #buckets: { index: number; bytes: number }[] = [];
  #startedAt = 0;
  #lastReceivedAt = -Infinity;
  #reported: { count: number; at: number; rate: number | null } | undefined;

  append(delta: string, receivedAt: number): void {
    if (receivedAt < this.#lastReceivedAt || receivedAt - this.#lastReceivedAt >= windowMs) {
      this.#buckets.length = 0;
      this.#startedAt = receivedAt;
    }
    this.#lastReceivedAt = receivedAt;
    const index = Math.floor((receivedAt - this.#startedAt) / bucketMs);
    const firstIndex = index - windowMs / bucketMs + 1;
    while (this.#buckets[0] && this.#buckets[0].index < firstIndex) this.#buckets.shift();
    const bytes = getUtf8ByteLength(delta);
    const last = this.#buckets.at(-1);
    if (last?.index === index) last.bytes += bytes;
    else this.#buckets.push({ index, bytes });
  }

  report(count: number, now: number): void {
    const previous = this.#reported;
    // 重复上报不刷新有效期。首次上报与累计值回退只建立基线，避免误算历史输出。
    if (previous?.count === count && now >= previous.at) return;
    const rate =
      previous && count > previous.count && now >= previous.at
        ? ((count - previous.count) * 1_000) / Math.max(1_000, now - previous.at)
        : null;
    this.#reported = { count, at: now, rate };
  }

  read(now: number): number | null {
    const reported = this.#reported;
    if (reported && reported.rate !== null && now - reported.at < windowMs) {
      return reported.rate;
    }
    // React 提交计时值前可能又收到一批输出，仍以最新的采样时刻为准。
    now = Math.max(now, this.#lastReceivedAt);
    if (now - this.#lastReceivedAt >= windowMs) return null;
    const elapsedMs = now - this.#startedAt;
    const firstIndex = Math.floor(elapsedMs / bucketMs) - windowMs / bucketMs + 1;
    let bytes = 0;
    for (const bucket of this.#buckets) {
      if (bucket.index >= firstIndex) bytes += bucket.bytes;
    }
    // 首批文本立即计入，分母至少为一秒，避免瞬间收到合并文本时放大速率。
    // ACP 文本块缺少 Token 边界，统一按 UTF-8 字节数估算。
    const seconds = Math.max(1_000, Math.min(elapsedMs, windowMs)) / 1_000;
    return bytes === 0 ? null : bytes / 4 / seconds;
  }
}

export class TurnOutputRates {
  readonly #rates = new Map<string, TurnOutputRate>();

  record(event: TaskStoreEvent<unknown>, turns: Readonly<Record<string, TaskEventTurn>>): void {
    if (event.type === "turn.completed") this.#rates.delete(event.turnId);
    if (event.type === "usage.updated") {
      const { outputTokens } = event.payload;
      if (outputTokens !== undefined && turns[event.turnId]?.status === "running") {
        this.#rateFor(event.turnId).report(outputTokens, Date.now());
      }
      return;
    }
    if (event.type !== "message.delta" && event.type !== "reasoning.delta") return;
    const { turnId, itemId, payload } = event;
    // 两条运行时链路的前台消息增量来自助手，主会话用户回显已在 ACP 投影前过滤。
    // 子会话、会话间消息和缺少增量正文的旧事件不参与计量，也无需读取任何消息条目。
    if (
      turns[turnId]?.status !== "running" ||
      typeof payload.delta !== "string" ||
      payload.delta.length === 0 ||
      itemId.startsWith("acp:child:") ||
      itemId.startsWith("acp:delegation:")
    )
      return;

    // 用客户端接收时间计量，远程主机与浏览器无需同步时钟。
    this.#rateFor(turnId).append(payload.delta, Date.now());
  }

  read(turnId: string, nowMs: number): number | null {
    return this.#rates.get(turnId)?.read(nowMs) ?? null;
  }

  clear(): void {
    this.#rates.clear();
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
