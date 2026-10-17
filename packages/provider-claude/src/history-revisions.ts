/** 只缓存固定长度内容版本和偏移，禁止把历史正文永久留在内存。淘汰后安全回退磁盘校验。 */
export class HistoryRevisions<T> {
  readonly #entries = new Map<string, T>();
  constructor(readonly limit: number) {}
  get(key: string): T | undefined {
    const value = this.#entries.get(key);
    if (value !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: T): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.limit) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
  }
  deletePrefix(prefix: string): void {
    for (const key of this.#entries.keys()) if (key.startsWith(prefix)) this.#entries.delete(key);
  }
}
