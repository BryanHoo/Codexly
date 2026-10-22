import type { LocalCatalogStore } from "@codexly/core";
import type { TokenUsageCounters, TokenUsageSample } from "@codexly/protocol";
import { record, text } from "./sdk-values.js";

function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function counters(value: unknown, model = false): TokenUsageCounters {
  const usage = record(value);
  const inputTokens = counter(usage[model ? "inputTokens" : "input_tokens"]);
  const outputTokens = counter(usage[model ? "outputTokens" : "output_tokens"]);
  const cacheReadTokens = counter(
    usage[model ? "cacheReadInputTokens" : "cache_read_input_tokens"],
  );
  const cacheWriteTokens = counter(
    usage[model ? "cacheCreationInputTokens" : "cache_creation_input_tokens"],
  );
  const values = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens];
  return {
    totalTokens:
      counter(usage["total_tokens"]) ??
      (values.some((v) => v !== null)
        ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
        : null),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}
const fields = [
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/** 只消费结构化用量边界；SDK 的正文 Token 增量不分配记录、不触发数据库调用。 */
export class ClaudeTokenUsage {
  readonly #steps = new Map<string, { model: string; usage: TokenUsageCounters }>();
  readonly #pending = new Set<Promise<unknown>>();
  #mainModel = "";
  #first = true;
  constructor(
    readonly taskId: string,
    readonly sessionId: string,
    readonly store: LocalCatalogStore,
    readonly resumed: boolean,
  ) {}
  receive(message: unknown, turnId: string): void {
    const value = record(message);
    if (value["type"] === "assistant") {
      const body = record(value["message"]),
        id = text(body["id"]),
        model = text(body["model"]);
      if (!value["parent_tool_use_id"]) this.#mainModel = model;
      // 仅旧会话首次恢复需要当前请求的实际输入作为基线，不累计并行工具的重复 assistant。
      if (this.#first && this.resumed && id && this.#steps.size < 4096)
        this.#steps.set(id, { model, usage: counters(body["usage"]) });
      return;
    }
    if (value["type"] !== "result") return;
    const models = Object.entries(record(value["modelUsage"]));
    if (models.length === 0 && counters(value["usage"]).totalTokens === null) return;
    if (models.length) {
      for (const [model, raw] of models) {
        const usage = counters(raw, true);
        let baseline: TokenUsageCounters | undefined;
        if (this.#first && this.resumed) {
          // SDK 新版本会恢复旧 session 累计值。首次没有统计水位时，只归属本次真实观测到的量；
          // 已有持久水位由 SQL 优先采用，因此正常重启和跨端恢复不会漏记或重复累计。
          const current = counters(undefined) as {
            -readonly [K in keyof TokenUsageCounters]: TokenUsageCounters[K];
          };
          for (const step of this.#steps.values())
            if (step.model === model) {
              for (const field of fields)
                if (
                  field !== "outputTokens" &&
                  field !== "totalTokens" &&
                  step.usage[field] !== null
                )
                  current[field] = (current[field] ?? 0) + step.usage[field];
            }
          if (model === this.#mainModel || models.length === 1)
            current.outputTokens = counters(value["usage"]).outputTokens;
          current.totalTokens =
            (current.inputTokens ?? 0) +
            (current.outputTokens ?? 0) +
            (current.cacheReadTokens ?? 0) +
            (current.cacheWriteTokens ?? 0);
          baseline = Object.fromEntries(
            fields.map((field) => [
              field,
              usage[field] === null ? null : Math.max(0, usage[field] - (current[field] ?? 0)),
            ]),
          ) as TokenUsageCounters;
        }
        this.#write({
          ...usage,
          ...(baseline ? { baseline } : {}),
          source: `${this.sessionId}:${model}`,
        });
      }
    } else {
      // 旧 SDK 或兼容提供方仅返回本回合 usage 时，按回合幂等记录，不伪造模型或缓存字段。
      this.#write({ ...counters(value["usage"]), source: `${this.sessionId}:turn:${turnId}` });
    }
    this.#first = false;
    this.#steps.clear();
  }
  #write(usage: TokenUsageCounters & { source: string; baseline?: TokenUsageCounters }): void {
    const sample: TokenUsageSample = {
      ...usage,
      taskId: this.taskId,
      engine: "claude",
      timestamp: new Date().toISOString(),
    };
    if (sample.totalTokens === null) return;
    const pending = Promise.resolve()
      .then(() => this.store.catalog("usage.record", sample))
      .catch(() => {
        // 统计失败独立于模型执行，不能中断任务或把已经成功的任务改成失败。
        console.warn("[codexly] token_usage_write_failed");
      })
      .finally(() => this.#pending.delete(pending));
    this.#pending.add(pending);
  }
  async flush(): Promise<void> {
    await Promise.allSettled(this.#pending);
  }
}
