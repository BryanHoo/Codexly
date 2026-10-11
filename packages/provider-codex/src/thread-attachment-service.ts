import type { CodexRpcClient } from "./codex-rpc-client.js";
import { CodexPersistentHistoricalAttachmentStore } from "./persistent-historical-attachment-store.js";
import { CodexThreadAttachmentRepository } from "./thread-attachment-repository.js";

export class CodexThreadAttachmentService {
  public readonly store: CodexPersistentHistoricalAttachmentStore;
  readonly #preparedTasks = new Set<string>();
  readonly #preparingTasks = new Map<string, Promise<void>>();
  readonly #repository: CodexThreadAttachmentRepository;

  public constructor(client: CodexRpcClient, attachmentDirectory: string) {
    this.#repository = new CodexThreadAttachmentRepository(client);
    this.store = new CodexPersistentHistoricalAttachmentStore(attachmentDirectory);
  }

  public async prepare(taskId: string): Promise<void> {
    if (this.#preparedTasks.has(taskId)) return;
    const existing = this.#preparingTasks.get(taskId);
    if (existing !== undefined) return existing;
    // 文件复验异步化后合并同一会话的恢复请求，避免并发 clearTask 撤销刚登记的授权。
    const pending = this.#repository.load(taskId).then(async (metadata) => {
      if (this.#preparingTasks.get(taskId) !== pending) return;
      await this.store.restoreTask(taskId, metadata);
      if (this.#preparingTasks.get(taskId) === pending) this.#preparedTasks.add(taskId);
    });
    this.#preparingTasks.set(taskId, pending);
    try {
      await pending;
    } finally {
      if (this.#preparingTasks.get(taskId) === pending) this.#preparingTasks.delete(taskId);
    }
  }

  public async flush(taskId: string): Promise<void> {
    for (const metadata of this.store.pendingMetadata(taskId)) {
      await this.#repository.add(taskId, metadata);
      this.store.markPersisted(taskId, metadata.attachment.id);
    }
  }

  public invalidate(taskId: string): void {
    this.#preparingTasks.delete(taskId);
    this.#preparedTasks.delete(taskId);
    this.#repository.invalidate(taskId);
    this.store.clearTask(taskId);
  }

  public forget(taskId: string): void {
    this.invalidate(taskId);
  }

  public deleteTask(taskId: string): void {
    this.#preparingTasks.delete(taskId);
    this.#preparedTasks.delete(taskId);
    this.#repository.invalidate(taskId);
    this.store.deleteTask(taskId);
  }

  public dispose(): void {
    this.#preparingTasks.clear();
    this.#preparedTasks.clear();
    this.#repository.clear();
    this.store.dispose();
  }
}
