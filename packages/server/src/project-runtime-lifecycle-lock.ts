export class ProjectRuntimeLifecycleLock {
  readonly #tails = new Map<string, Promise<void>>();

  public async run<Value>(projectId: string, operation: () => Promise<Value>): Promise<Value> {
    const predecessor = this.#tails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(projectId, tail);

    // 同一 Project 严格按进入顺序执行，不同 Project 仍可并行创建或释放。
    await predecessor.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(projectId) === tail) {
        this.#tails.delete(projectId);
      }
    }
  }
}
