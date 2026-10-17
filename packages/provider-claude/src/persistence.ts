import type { AgentTurn } from "@codexly/protocol";
import type { ClaudeHistory, ClaudeTaskMetadata, ClaudeRecovery } from "./history.js";

export interface ClaudeRecoverySnapshot {
  turns: AgentTurn[];
  metadata: ClaudeTaskMetadata;
  pending: boolean;
}

/** 写盘失败只影响恢复状态。未落盘的终态留在内存，已落盘的恢复记录支持宿主重启重放。 */
export class ClaudePersistence {
  readonly #pending = new Map<string, ClaudeRecovery>();
  readonly #operations = new Map<string, Promise<unknown>>();
  constructor(readonly history: ClaudeHistory) {}

  hasPending(id: string): boolean {
    return this.#pending.has(id);
  }
  get pendingCount(): number {
    return this.#pending.size;
  }
  /** 等待已有恢复事务完成，再删除磁盘和内存恢复记录，避免读取重试重建历史。 */
  deleteTask(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      await this.history.deleteTask(id);
      this.#pending.delete(id);
    });
  }

  #enqueue<T>(id: string, action: () => Promise<T>): Promise<T> {
    const result = (this.#operations.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    this.#operations.set(id, result);
    void result
      .finally(() => {
        if (this.#operations.get(id) === result) this.#operations.delete(id);
      })
      .catch(() => undefined);
    return result;
  }

  /** 检查点与退出清理按会话合并提交，避免为每个后台回合重复写入同一份元数据。 */
  settleAll(
    id: string,
    entries: ClaudeRecovery["entries"],
    metadata: ClaudeTaskMetadata,
  ): Promise<ClaudeRecoverySnapshot> {
    return this.#enqueue(id, async () => {
      const recovery = this.#pending.get(id) ??
        (await this.history.recovery(id)) ?? { entries: [], metadata };
      // 后台通知可以更新待恢复投影，但不能把尚未追加的回合降为仅覆盖快照。
      for (const { turn, mode } of entries) {
        const entry = recovery.entries.find((entry) => entry.turn.id === turn.id);
        const { persistence: _persistence, ...snapshot } = turn;
        if (entry) entry.turn = snapshot;
        else recovery.entries.push({ turn: snapshot, mode });
      }
      recovery.metadata = metadata;
      this.#pending.set(id, recovery);
      return this.#attempt(id, recovery);
    });
  }

  retry(id: string): Promise<ClaudeRecoverySnapshot | undefined> {
    return this.#enqueue(id, async () => {
      const recovery = this.#pending.get(id) ?? (await this.history.recovery(id));
      if (!recovery) return undefined;
      this.#pending.set(id, recovery);
      return this.#attempt(id, recovery);
    });
  }

  async #attempt(id: string, recovery: ClaudeRecovery): Promise<ClaudeRecoverySnapshot> {
    try {
      // 恢复记录先于历史追加，包含真实结果与配套元数据；中途失败可安全重放。
      await this.history.saveRecovery(id, recovery);
      for (const entry of recovery.entries) {
        if (entry.mode === "complete") await this.history.complete(id, entry.turn);
        else await this.history.update(id, entry.turn);
      }
      await this.history.saveMetadata(id, recovery.metadata);
      await this.history.clearRecovery(id);
      this.#pending.delete(id);
      return {
        turns: recovery.entries.map((entry) => entry.turn),
        metadata: recovery.metadata,
        pending: false,
      };
    } catch (error) {
      // 即使磁盘已满到无法写恢复记录，也保留内存结果并明确报告未持久化，供后续读取重试。
      const persistence = {
        status: "failed" as const,
        error: error instanceof Error ? error.message : "Claude persistence failed",
      };
      return {
        turns: recovery.entries.map((entry) => ({ ...entry.turn, persistence })),
        metadata: recovery.metadata,
        pending: true,
      };
    }
  }
}
