import { getUtf8ByteLength } from "./byte-lru.js";
import type { TaskEventTurn, TaskStoreEvent } from "./task-event-model.js";

const windowMs = 3_000;
const bucketMs = 250;

/** 只保留最近三秒的字节计数，展示跨模型的近似值，无需保留或重扫正文。 */
class TurnOutputRate {
  readonly #buckets: { index: number; bytes: number }[] = [];
  #startedAt = 0;
  #lastReceivedAt = -Infinity;

  append(delta: string, receivedAt: number): void {
    if (receivedAt < this.#lastReceivedAt || receivedAt - this.#lastReceivedAt >= windowMs) {
      this.#buckets.length = 0;
      this.#startedAt = receivedAt;
    }
    this.#lastReceivedAt = receivedAt;
    const index = Math.floor((receivedAt - this.#startedAt) / bucketMs);
    // 首批输出只建立计时基线，避免合并交付的正文瞬间变成速率尖峰。
    if (index === 0) return;

    const firstIndex = index - windowMs / bucketMs + 1;
    while (this.#buckets[0] && this.#buckets[0].index < firstIndex) this.#buckets.shift();
    const bytes = getUtf8ByteLength(delta);
    const last = this.#buckets.at(-1);
    if (last?.index === index) last.bytes += bytes;
    else this.#buckets.push({ index, bytes });
  }

  read(now: number): number | null {
    // React 提交计时值前可能又收到一批输出，仍以最新的采样时刻为准。
    now = Math.max(now, this.#lastReceivedAt);
    if (now - this.#lastReceivedAt >= windowMs) return null;
    const elapsedMs = now - this.#startedAt;
    const firstIndex = Math.floor(elapsedMs / bucketMs) - windowMs / bucketMs + 1;
    let bytes = 0;
    for (const bucket of this.#buckets) {
      if (bucket.index >= firstIndex) bytes += bucket.bytes;
    }
    // ACP 文本块不包含模型的 Token 边界，按 UTF-8 字节数估算并保留一位小数供界面展示。
    const seconds = Math.max(1_000, Math.min(elapsedMs, windowMs)) / 1_000;
    return bytes === 0 ? null : bytes / 4 / seconds;
  }
}

export class TurnOutputRates {
  readonly #rates = new Map<string, TurnOutputRate>();

  record(event: TaskStoreEvent<unknown>, turns: Readonly<Record<string, TaskEventTurn>>): void {
    if (event.type === "turn.completed") this.#rates.delete(event.turnId);
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

    let rate = this.#rates.get(turnId);
    if (rate === undefined) {
      rate = new TurnOutputRate();
      this.#rates.set(turnId, rate);
    }
    // 用客户端接收时间计量，远程主机与浏览器无需同步时钟。
    rate.append(payload.delta, Date.now());
  }

  read(turnId: string, nowMs: number): number | null {
    return this.#rates.get(turnId)?.read(nowMs) ?? null;
  }

  clear(): void {
    this.#rates.clear();
  }
}
