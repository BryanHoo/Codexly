import type { CodexRpcClient } from "./codex-rpc-client.js";
import { CodexPersistentHistoricalAttachmentStore } from "./persistent-historical-attachment-store.js";
import { CodexThreadAttachmentRepository } from "./thread-attachment-repository.js";

export class CodexThreadAttachmentService {
  public readonly store: CodexPersistentHistoricalAttachmentStore;
  readonly #preparedTasks = new Set<string>();
  readonly #repository: CodexThreadAttachmentRepository;

  public constructor(client: CodexRpcClient, attachmentDirectory: string) {
    this.#repository = new CodexThreadAttachmentRepository(client);
    this.store = new CodexPersistentHistoricalAttachmentStore(attachmentDirectory);
  }

  public async prepare(taskId: string): Promise<void> {
    if (this.#preparedTasks.has(taskId)) return;
    this.store.restoreTask(taskId, await this.#repository.load(taskId));
    this.#preparedTasks.add(taskId);
  }

  public async flush(taskId: string): Promise<void> {
    for (const metadata of this.store.pendingMetadata(taskId)) {
      await this.#repository.add(taskId, metadata);
      this.store.markPersisted(taskId, metadata.attachment.id);
    }
  }

  public invalidate(taskId: string): void {
    this.#preparedTasks.delete(taskId);
    this.#repository.invalidate(taskId);
    this.store.clearTask(taskId);
  }

  public forget(taskId: string): void {
    this.invalidate(taskId);
  }

  public deleteTask(taskId: string): void {
    this.#preparedTasks.delete(taskId);
    this.#repository.invalidate(taskId);
    this.store.deleteTask(taskId);
  }

  public dispose(): void {
    this.#preparedTasks.clear();
    this.#repository.clear();
    this.store.dispose();
  }
}
