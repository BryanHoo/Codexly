import type { AcpConnection } from "./connection.js";
import type { AcpHistory } from "./history.js";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";

/** Provider 的使用登记与缓存策略分离；同一任务的串行操作共用一份保护。 */
export class AcpHistoryUse {
  readonly #users = new Map<string, () => Promise<void>>();
  constructor(readonly history: AcpHistory) {}
  async retain(id: string, ephemeral = false): Promise<void> {
    if (ephemeral || this.#users.has(id)) return;
    this.#users.set(id, await this.history.cache.acquire(id));
  }
  async connect(id: string, get: () => Promise<AcpConnection>, ephemeral: boolean) {
    await this.retain(id, ephemeral);
    const agent = await get();
    if (!ephemeral)
      await this.history.cache.setReplayable(
        id,
        agent.initialization.agentCapabilities?.loadSession === true,
      );
    return agent;
  }
  async release(id: string): Promise<void> {
    const release = this.#users.get(id);
    if (!release) return;
    this.#users.delete(id);
    await release();
    await this.history.cache.prune();
  }
  async readAttachment(originals: HistoricalTaskAttachments, task: string, id: string) {
    const original = await originals.read(task, id);
    if (original) return original;
    const release = await this.history.cache.acquire(task);
    try {
      return await this.history.cache.content(task).read(task, id);
    } finally {
      await release();
    }
  }
  async close(): Promise<void> {
    const releases = await Promise.allSettled(
      [...this.#users.keys()].map((id) => this.release(id)),
    );
    // 并发释放时其他回收者可能因维护锁忙而跳过；全部释放后再统一收敛一次。
    await this.history.cache.prune();
    const failures = releases.filter((entry) => entry.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((entry): unknown => entry.reason),
        "ACP 历史缓存释放失败",
      );
  }
}
