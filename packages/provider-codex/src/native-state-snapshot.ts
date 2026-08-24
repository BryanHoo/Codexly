const DEFAULT_NATIVE_STATE_SNAPSHOT_TTL_MS = 1_000;

class ShortLivedSnapshot<T> {
  readonly #load: () => Promise<T>;
  readonly #ttlMs: number;
  #entry: Readonly<{ expiresAt: number; value: T }> | undefined;
  #generation = 0;
  #inFlight: Promise<T> | undefined;

  public constructor(load: () => Promise<T>, ttlMs: number) {
    this.#load = load;
    this.#ttlMs = Math.max(0, ttlMs);
  }

  public read(): Promise<T> {
    const entry = this.#entry;
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return Promise.resolve(entry.value);
    }
    this.#entry = undefined;
    if (this.#inFlight !== undefined) return this.#inFlight;

    const generation = this.#generation;
    const inFlight = this.#load()
      .then((value) => {
        // 只允许当前代次回填，防止写操作后的旧请求污染新快照。
        if (generation === this.#generation) {
          this.#entry = { expiresAt: Date.now() + this.#ttlMs, value };
        }
        return value;
      })
      .finally(() => {
        if (this.#inFlight === inFlight) this.#inFlight = undefined;
      });
    this.#inFlight = inFlight;
    return inFlight;
  }

  public clear(): void {
    this.#generation += 1;
    this.#entry = undefined;
    this.#inFlight = undefined;
  }
}

export class CodexNativeStateSnapshot<TConfig, TAccount> {
  readonly #account: ShortLivedSnapshot<TAccount>;
  readonly #config: ShortLivedSnapshot<TConfig>;

  public constructor(
    loaders: Readonly<{
      account: () => Promise<TAccount>;
      config: () => Promise<TConfig>;
    }>,
  ) {
    this.#config = new ShortLivedSnapshot(loaders.config, DEFAULT_NATIVE_STATE_SNAPSHOT_TTL_MS);
    this.#account = new ShortLivedSnapshot(loaders.account, DEFAULT_NATIVE_STATE_SNAPSHOT_TTL_MS);
  }

  public readConfig(): Promise<TConfig> {
    return this.#config.read();
  }

  public readAccount(): Promise<TAccount> {
    return this.#account.read();
  }

  public clear(): void {
    this.#config.clear();
    this.#account.clear();
  }
}
