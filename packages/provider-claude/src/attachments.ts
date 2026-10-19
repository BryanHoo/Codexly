import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { renameStorageFile } from "./storage-rename.js";
import { join } from "node:path";
import { copyClaudeStorage } from "./storage-copy.js";
import type { AgentProviderTurnInput } from "@codexly/core";
import type { AgentMessageAttachment } from "@codexly/protocol";
import {
  PersistentHistoricalAttachmentStore,
  type HistoricalAttachmentMetadata,
} from "@codexly/core/persistent-historical-attachment-store";

/** 与 Codex 共用正文仓储；每个引用独立落盘，读取旧附件不需要扫描分页历史。 */
export class ClaudeAttachments {
  readonly store: PersistentHistoricalAttachmentStore;
  constructor(readonly directory: string) {
    this.store = new PersistentHistoricalAttachmentStore(join(directory, "blobs"));
  }
  #directory(taskId: string) {
    return join(this.directory, "references", createHash("sha256").update(taskId).digest("hex"));
  }
  #path(taskId: string, id: string) {
    return join(this.#directory(taskId), createHash("sha256").update(id).digest("hex"));
  }
  async prepare(taskId: string, input: AgentProviderTurnInput): Promise<AgentMessageAttachment[]> {
    const attachments: AgentMessageAttachment[] = [];
    const add = (attachment: AgentMessageAttachment | undefined) => {
      // 发送成功必须意味着历史可恢复；正文持久化失败时不能静默丢弃卡片再启动 SDK。
      if (!attachment) throw new Error("Claude 附件保存失败，请检查附件与存储后重试");
      attachments.push(attachment);
    };
    for (const [index, image] of input.images.entries())
      add(await this.store.addLocalImage(taskId, image.path, index));
    for (const [index, text] of input.textAttachments.entries())
      add(await this.store.addText(taskId, text, index));
    for (const file of input.files) add(await this.store.addLocalFile(taskId, file));
    for (const metadata of this.store.pendingMetadata(taskId)) {
      await mkdir(this.#directory(taskId), { recursive: true, mode: 0o700 });
      const path = this.#path(taskId, metadata.attachment.id);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(metadata), { mode: 0o600 });
        await renameStorageFile(temporary, path);
        this.store.markPersisted(taskId, metadata.attachment.id);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    return attachments;
  }
  async read(taskId: string, id: string) {
    let metadata: Omit<HistoricalAttachmentMetadata, "schemaVersion"> & { schemaVersion: unknown };
    try {
      metadata = JSON.parse(
        await readFile(this.#path(taskId, id), "utf8"),
      ) as HistoricalAttachmentMetadata;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    if (metadata.schemaVersion !== 1 || metadata.attachment.id !== id) return undefined;
    await this.store.restoreAttachment(taskId, { ...metadata, schemaVersion: 1 });
    return this.store.read(taskId, id);
  }
  async deleteTask(taskId: string) {
    await this.store.removeTask(taskId);
    await rm(this.#directory(taskId), { recursive: true, force: true });
    await rm(join(this.directory, "exports", createHash("sha256").update(taskId).digest("hex")), {
      recursive: true,
      force: true,
    });
  }
  /** 只复制分叉点之前实际展示的附件；引用 ID 不变，正文及删除生命周期归新任务独立所有。 */
  async forkAttachment(source: string, target: string, id: string): Promise<void> {
    const metadata = JSON.parse(await readFile(this.#path(source, id), "utf8")) as Omit<
      HistoricalAttachmentMetadata,
      "schemaVersion"
    > & { schemaVersion: unknown };
    if (
      metadata.schemaVersion !== 1 ||
      metadata.attachment.id !== id ||
      !/^[a-f0-9]{64}$/u.test(metadata.blobKey)
    )
      throw new Error("Claude 分叉附件记录无效");
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const targetHash = createHash("sha256").update(target).digest("hex");
    await mkdir(this.#directory(target), { recursive: true, mode: 0o700 });
    await copyClaudeStorage(
      join(this.directory, "blobs", sourceHash, metadata.blobKey),
      join(this.directory, "blobs", targetHash, metadata.blobKey),
      true,
    );
    await writeFile(this.#path(target, id), JSON.stringify(metadata), { mode: 0o600 });
  }
}
