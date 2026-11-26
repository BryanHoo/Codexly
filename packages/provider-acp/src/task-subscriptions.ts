import type { AgentProvider } from "@codexly/core";

interface Subscription {
  provider: AgentProvider;
  leases: Set<string>;
}

/** 应用视图的订阅登记；不是 ACP agent 的排他写锁，也不修改会话或历史身份。 */
export class AcpTaskSubscriptions {
  readonly #tasks = new Map<string, Subscription>();
  readonly #operations = new Map<string, Promise<void>>();
  #closed = false;

  retain(provider: AgentProvider, project: string, task: string, lease: string): Promise<void> {
    const key = JSON.stringify([project, task]);
    return this.#serial(key, async () => {
      // 仅查应用目录验证归属，不为保留视图启动 agent 或加载模型会话。
      if (!(await provider.readTaskMetadata?.(task))) throw new Error("Task not found");
      if (this.#closed) throw new Error("ACP subscriptions closed");
      let entry = this.#tasks.get(key);
      if (!entry) {
        if (this.#tasks.size >= 512) throw new Error("ACP subscription capacity");
        entry = { provider, leases: new Set() };
        this.#tasks.set(key, entry);
      }
      if (!entry.leases.has(lease) && entry.leases.size >= 64)
        throw new Error("ACP task subscription capacity");
      entry.leases.add(lease);
    });
  }

  release(project: string, task: string, lease: string): Promise<void> {
    const key = JSON.stringify([project, task]);
    return this.#serial(key, async () => {
      const entry = this.#tasks.get(key);
      if (!entry) return;
      entry.leases.delete(lease);
      await this.#retire(key, task, entry);
    });
  }

  completed(project: string, task: string): Promise<void> {
    const key = JSON.stringify([project, task]);
    if (this.#closed || !this.#tasks.has(key)) return Promise.resolve();
    return this.#serial(key, async () => {
      const entry = this.#tasks.get(key);
      if (entry) await this.#retire(key, task, entry);
    });
  }

  forget(project: string, task: string): void {
    const key = JSON.stringify([project, task]);
    if (!this.#operations.has(key)) {
      this.#tasks.delete(key);
      return;
    }
    // 删除也排在该任务的在途目录读取之后，防止旧 retain 用迟到快照复活登记。
    void this.#serial(key, () => {
      this.#tasks.delete(key);
      return Promise.resolve();
    }).catch(() => undefined);
  }

  async #retire(key: string, task: string, entry: Subscription): Promise<void> {
    if (entry.leases.size || this.#closed) return;
    // Provider 等待回合历史落盘；busy 或失败保留登记，终态/重试再释放，不轮询。
    const status = await entry.provider.unsubscribeTask(task);
    if (status !== "busy" && this.#tasks.get(key) === entry) this.#tasks.delete(key);
  }

  #serial(key: string, action: () => Promise<void>): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("ACP subscriptions closed"));
    if (!this.#operations.has(key) && this.#operations.size >= 512)
      return Promise.reject(new Error("ACP subscription operation capacity"));
    const operation = (this.#operations.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (this.#closed) throw new Error("ACP subscriptions closed");
        return action();
      })
      .finally(() => {
        if (this.#operations.get(key) === operation) this.#operations.delete(key);
      });
    this.#operations.set(key, operation);
    return operation;
  }

  stop(): void {
    this.#closed = true;
    this.#tasks.clear();
  }

  async settled(): Promise<void> {
    await Promise.allSettled(this.#operations.values());
  }
}
