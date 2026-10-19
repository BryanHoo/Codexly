/** 固定保留最近 1024 个数值；热路径 O(1)，仅在读取指标时排序副本。 */
export class MetricDistribution {
  readonly #values = new Float64Array(1024);
  #count = 0;

  public record(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.#values[this.#count % this.#values.length] = value;
    this.#count += 1;
  }

  public get metrics(): Readonly<{ count: number; p95: number; p99: number }> {
    const values = this.#values.slice(0, Math.min(this.#count, this.#values.length)).sort();
    const percentile = (p: number) => values[Math.ceil(values.length * p) - 1] ?? 0;
    return { count: this.#count, p95: percentile(0.95), p99: percentile(0.99) };
  }
}
