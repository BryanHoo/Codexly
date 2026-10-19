export interface RetainedWorkLimits {
  maxCount: number;
  maxBytes: number;
  maxTaskCount: number;
  maxTaskBytes: number;
}

/** 数量和字节同时覆盖等待与执行中的任务；释放函数幂等，适用于取消与晚到结果竞争。 */
export class RetainedWorkBudget {
  readonly #tasks = new Map<string, { count: number; bytes: number }>();
  #count = 0;
  #bytes = 0;

  public constructor(private readonly limits: RetainedWorkLimits) {
    for (const value of Object.values(limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Invalid work budget");
    }
  }

  public get usage(): Readonly<{ count: number; bytes: number }> {
    return { count: this.#count, bytes: this.#bytes };
  }

  public reserve(taskKey: string, bytes: number): (() => void) | undefined {
    const task = this.#tasks.get(taskKey) ?? { count: 0, bytes: 0 };
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.#count >= this.limits.maxCount ||
      this.#bytes + bytes > this.limits.maxBytes ||
      task.count >= this.limits.maxTaskCount ||
      task.bytes + bytes > this.limits.maxTaskBytes
    )
      return undefined;
    this.#count++;
    this.#bytes += bytes;
    task.count++;
    task.bytes += bytes;
    this.#tasks.set(taskKey, task);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#count--;
      this.#bytes -= bytes;
      task.count--;
      task.bytes -= bytes;
      if (task.count === 0) this.#tasks.delete(taskKey);
    };
  }
}

/** 估算 JSON 载荷保留成本：UTF-16 字符串加容器/字段开销，避免 stringify 再复制大正文。
 * 遍历本身也受字节与节点数限制；超深、循环或异常复杂输入直接触发有序降级。
 */
export function estimateRetainedBytes(value: unknown, limit: number): number {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  let bytes = 256;
  let nodes = 0;
  while (pending.length > 0) {
    if (++nodes > 16_384 || bytes > limit) return Infinity;
    const next = pending.pop();
    if (typeof next === "string") bytes += next.length * 2;
    else if (next !== null && typeof next === "object") {
      if (seen.has(next)) return Infinity;
      seen.add(next);
      bytes += 64;
      for (const key of Object.keys(next)) {
        bytes += key.length * 2 + 32;
        if (bytes > limit || pending.length >= 16_384) return Infinity;
        pending.push((next as Record<string, unknown>)[key]);
      }
    } else bytes += 8;
  }
  return bytes;
}
