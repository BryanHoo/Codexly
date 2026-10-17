import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import type { AgentProviderAttachment } from "./agent-provider.js";
import {
  MAX_AGENT_HISTORY_IMAGES,
  MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachmentKind,
  type AgentImageMediaType,
  type AgentMessageAttachment,
} from "@codexly/protocol";

import {
  imageExtensionsByMediaType,
  normalizeAttachmentName,
} from "./historical-attachment-files.js";
import {
  historicalAttachmentWorkers,
  InvalidHistoricalAttachmentError,
  type AttachmentWorkerJob,
} from "./historical-attachment-worker-pool.js";
export type StagedImageAttachment = Readonly<{
  contentDigest: string;
  mediaType: AgentImageMediaType;
  path: string;
  size: number;
}>;

/** 引擎只负责保存引用；正文格式、稳定身份及下载校验由共享仓储维护。 */
export type HistoricalAttachmentMetadata = Readonly<{
  attachment: AgentMessageAttachment;
  blobKey: string;
  schemaVersion: 1;
}>;

// 分支可以继承附件引用 ID；内存授权必须同时按任务隔离，不能由源任务占用或撤销分支授权。
const attachmentKey = (taskId: string, attachmentId: string) =>
  JSON.stringify([taskId, attachmentId]);

type PersistentEntry = Readonly<{
  attachment: AgentMessageAttachment;
  blobKey: string;
  path: string;
  taskId: string;
}>;

export type HistoricalAttachmentResult =
  AgentMessageAttachment | undefined | Promise<AgentMessageAttachment | undefined>;

export interface HistoricalAttachmentStore {
  addBase64Image(
    taskId: string,
    input: Readonly<{ encoded: string; name?: string }>,
    imageIndex: number,
  ): HistoricalAttachmentResult;
  addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): HistoricalAttachmentResult;
  addLocalFile(
    taskId: string,
    input: Readonly<{ mediaType: string; name: string; path: string }>,
  ): HistoricalAttachmentResult;
  addLocalImage(taskId: string, path: string, imageIndex: number): HistoricalAttachmentResult;
  addStagedImage(
    taskId: string,
    staged: StagedImageAttachment,
    imageIndex: number,
    inputName?: string,
  ): HistoricalAttachmentResult;
  addText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): HistoricalAttachmentResult;
  clearTask(taskId: string): void;
  dispose(): void;
  read(taskId: string, attachmentId: string): Promise<AgentProviderAttachment | undefined>;
}

export class PersistentHistoricalAttachmentStore implements HistoricalAttachmentStore {
  readonly #entries = new Map<string, PersistentEntry>();
  readonly #pending = new Map<string, Map<string, HistoricalAttachmentMetadata>>();
  #totalBytes = 0;
  #disposed = false;
  readonly #taskEpochs = new Map<string, object>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();

  public constructor(private readonly directory: string) {
    // 目录按首个附件延迟创建，仅读取 Thread 不产生空的本地状态。
  }

  public async addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): Promise<AgentMessageAttachment | undefined> {
    // 先用字符串长度拒绝超大输入，Base64 正则、解码和正文校验交给 Worker。
    if (input.url.length > Math.ceil((MAX_AGENT_IMAGE_BYTES * 4) / 3) + 64) return undefined;
    const separator = input.url.indexOf(",");
    const prefix = input.url.slice(0, separator);
    const match = /^data:(image\/(?:gif|jpeg|png|webp));base64$/u.exec(prefix);
    if (match === null) return undefined;
    return this.#add(
      taskId,
      "image",
      match[1],
      normalizeAttachmentName(input.name, `图片-${String(imageIndex + 1)}`),
      { type: "base64", value: input.url.slice(separator + 1) },
    );
  }

  public async addBase64Image(
    taskId: string,
    input: Readonly<{ encoded: string; name?: string }>,
    imageIndex: number,
  ): Promise<AgentMessageAttachment | undefined> {
    if (input.encoded.length > Math.ceil((MAX_AGENT_IMAGE_BYTES * 4) / 3) + 4) return undefined;
    return this.#add(
      taskId,
      "image",
      undefined,
      (mediaType) =>
        normalizeAttachmentName(
          input.name,
          `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[mediaType as AgentImageMediaType]}`,
        ),
      { type: "base64", value: input.encoded },
    );
  }

  public async addStagedImage(
    taskId: string,
    staged: StagedImageAttachment,
    imageIndex: number,
    inputName?: string,
  ): Promise<AgentMessageAttachment | undefined> {
    if (staged.size <= 0 || staged.size > MAX_AGENT_IMAGE_BYTES) return undefined;
    const attachment = await this.#add(
      taskId,
      "image",
      staged.mediaType,
      normalizeAttachmentName(
        inputName,
        `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[staged.mediaType]}`,
      ),
      { type: "file", path: staged.path },
      staged,
    );
    if (attachment !== undefined)
      await rm(staged.path, { force: true }).catch(() => {
        // 文件清理失败不影响已经完成的授权状态变更。
      });
    return attachment;
  }

  public async addLocalImage(
    taskId: string,
    path: string,
    imageIndex: number,
  ): Promise<AgentMessageAttachment | undefined> {
    if (!isAbsolute(path)) return undefined;
    return this.#add(
      taskId,
      "image",
      undefined,
      normalizeAttachmentName(basename(path), `图片-${String(imageIndex + 1)}`),
      { type: "file", path },
    );
  }

  public async addText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): Promise<AgentMessageAttachment | undefined> {
    if (input.text.length > MAX_AGENT_TEXT_BYTES) return undefined;
    return this.#add(
      taskId,
      "text",
      "text/plain",
      normalizeAttachmentName(input.name, `Pasted text-${String(textIndex + 1)}.txt`),
      { type: "text", value: input.text },
    );
  }

  public async addLocalFile(
    taskId: string,
    input: Readonly<{ mediaType: string; name: string; path: string }>,
  ): Promise<AgentMessageAttachment | undefined> {
    if (!isAbsolute(input.path)) return undefined;
    return this.#add(
      taskId,
      "file",
      input.mediaType,
      normalizeAttachmentName(input.name, "Attachment"),
      { type: "file", path: input.path },
    );
  }

  public async restoreTask(
    taskId: string,
    metadata: readonly HistoricalAttachmentMetadata[],
  ): Promise<void> {
    this.clearTask(taskId);
    const epoch = this.#epoch(taskId);
    for (const record of metadata) {
      // 整批恢复共用同一代授权；清理发生后不能由后续记录重建已撤销的任务。
      if (!this.#isCurrent(taskId, epoch)) return;
      await this.restoreAttachment(taskId, record);
    }
  }

  /** 按需恢复单个引用，不扫描全部历史，也不撤销同任务的并发下载授权。 */
  public async restoreAttachment(
    taskId: string,
    record: HistoricalAttachmentMetadata,
  ): Promise<void> {
    if (this.#disposed || !/^[a-f0-9]{64}$/u.test(record.blobKey)) return;
    const epoch = this.#epoch(taskId);
    const path = this.#blobPath(taskId, record.blobKey);
    try {
      const stats = await stat(path);
      if (
        !this.#isCurrent(taskId, epoch) ||
        this.#entries.has(attachmentKey(taskId, record.attachment.id))
      )
        return;
      if (!stats.isFile() || stats.size !== record.attachment.size) return;
      this.#ensureCapacity(record.attachment.size);
      this.#register({ attachment: record.attachment, blobKey: record.blobKey, path, taskId });
    } catch {
      // 元数据与正文可能被独立清理；缺失正文不再授权下载。
    }
  }

  public pendingMetadata(taskId: string): readonly HistoricalAttachmentMetadata[] {
    return [...(this.#pending.get(taskId)?.values() ?? [])];
  }

  public markPersisted(taskId: string, attachmentId: string): void {
    const pending = this.#pending.get(taskId);
    pending?.delete(attachmentId);
    if (pending?.size === 0) this.#pending.delete(taskId);
  }

  public async read(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    const key = attachmentKey(taskId, attachmentId);
    const entry = this.#entries.get(key);
    if (entry?.taskId !== taskId) return undefined;
    try {
      // 下载正文也在 Worker 中流式复验哈希，最后转移 ArrayBuffer，主线程不再计算整块摘要。
      const result = await historicalAttachmentWorkers.run({
        operation: "read",
        source: { type: "file", path: entry.path },
        kind: entry.attachment.kind,
        mediaType: entry.attachment.mediaType,
        maxBytes: entry.attachment.size,
        size: entry.attachment.size,
        digest: entry.blobKey,
      });
      if (this.#entries.get(key) !== entry || result.content === undefined) return undefined;
      this.#touch(entry);
      return { ...entry.attachment, content: Buffer.from(result.content) };
    } catch (error) {
      if (error instanceof InvalidHistoricalAttachmentError && this.#entries.get(key) === entry) {
        this.#forget(key);
        await rm(entry.path, { force: true }).catch(() => {
          // 损坏附件必须撤销授权，外部文件系统清理失败不应恢复旧授权。
        });
      }
      // 繁忙或 Worker 故障不撤销已有授权；后续读取仍会完整复验正文。
      return undefined;
    }
  }

  public clearTask(taskId: string): void {
    this.#taskEpochs.delete(taskId);
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.taskId === taskId) this.#forget(attachmentId);
    }
    this.#pending.delete(taskId);
  }

  public deleteTask(taskId: string): void {
    void this.removeTask(taskId).catch(() => {
      // 兼容原有授权撤销入口；需要确认磁盘清理的永久删除流程使用 removeTask。
    });
  }

  public async removeTask(taskId: string): Promise<void> {
    this.clearTask(taskId);
    // 删除先撤销授权，再等待此前已提交的写入结束，防止晚到的任务重建已删除目录。
    const inflight = [...(this.#inflight.get(taskId) ?? [])];
    await Promise.allSettled(inflight);
    await rm(this.#taskDirectory(taskId), { force: true, recursive: true });
  }

  public dispose(): void {
    this.#disposed = true;
    this.#taskEpochs.clear();
    this.#entries.clear();
    this.#pending.clear();
    this.#totalBytes = 0;
  }

  async #add(
    taskId: string,
    kind: AgentAttachmentKind,
    mediaType: string | undefined,
    attachmentName: string | ((mediaType: string) => string),
    source: AttachmentWorkerJob["source"],
    staged?: StagedImageAttachment,
  ): Promise<AgentMessageAttachment | undefined> {
    if (this.#disposed) return undefined;
    const epoch = this.#epoch(taskId);
    const maxBytes =
      kind === "image"
        ? MAX_AGENT_IMAGE_BYTES
        : kind === "text"
          ? MAX_AGENT_TEXT_BYTES
          : MAX_AGENT_FILE_BYTES;
    const job = historicalAttachmentWorkers.run({
      operation: "persist",
      source,
      directory: this.#taskDirectory(taskId),
      kind,
      maxBytes,
      ...(mediaType === undefined ? {} : { mediaType }),
      ...(staged === undefined ? {} : { size: staged.size, digest: staged.contentDigest }),
    });
    const inflight = this.#inflight.get(taskId) ?? new Set<Promise<unknown>>();
    inflight.add(job);
    this.#inflight.set(taskId, inflight);
    try {
      const result = await job;
      if (!this.#isCurrent(taskId, epoch) || result.path === undefined) return undefined;
      const name =
        typeof attachmentName === "string" ? attachmentName : attachmentName(result.mediaType);
      // 仅对少量身份元数据同步哈希；大正文的 SHA-256 已由有界 Worker 完成。
      const id = `history-${createHash("sha256")
        .update(JSON.stringify([taskId, kind, result.mediaType, name, result.size, result.blobKey]))
        .digest("hex")}`;
      const existing = this.#entries.get(attachmentKey(taskId, id));
      if (existing !== undefined) {
        this.#touch(existing);
        return existing.attachment;
      }
      const attachment: AgentMessageAttachment = {
        id,
        kind,
        mediaType: result.mediaType,
        name,
        size: result.size,
      };
      this.#ensureCapacity(attachment.size);
      this.#register({ attachment, blobKey: result.blobKey, path: result.path, taskId });
      const taskPending =
        this.#pending.get(taskId) ?? new Map<string, HistoricalAttachmentMetadata>();
      taskPending.set(id, { attachment, blobKey: result.blobKey, schemaVersion: 1 });
      this.#pending.set(taskId, taskPending);
      return attachment;
    } catch {
      // 单个附件无效、源文件消失或Worker 故障只产生占位符，不中断其他会话。
      return undefined;
    } finally {
      inflight.delete(job);
      if (inflight.size === 0 && this.#inflight.get(taskId) === inflight)
        this.#inflight.delete(taskId);
    }
  }

  #isCurrent(taskId: string, epoch: object): boolean {
    return !this.#disposed && this.#taskEpochs.get(taskId) === epoch;
  }

  #epoch(taskId: string): object {
    const epoch = this.#taskEpochs.get(taskId) ?? {};
    this.#taskEpochs.set(taskId, epoch);
    return epoch;
  }

  #taskDirectory(taskId: string): string {
    return join(this.directory, createHash("sha256").update(taskId).digest("hex"));
  }

  #blobPath(taskId: string, blobKey: string): string {
    return join(this.#taskDirectory(taskId), blobKey);
  }

  #register(entry: PersistentEntry): void {
    this.#entries.set(attachmentKey(entry.taskId, entry.attachment.id), entry);
    this.#totalBytes += entry.attachment.size;
  }

  #touch(entry: PersistentEntry): void {
    this.#entries.delete(attachmentKey(entry.taskId, entry.attachment.id));
    this.#entries.set(attachmentKey(entry.taskId, entry.attachment.id), entry);
  }

  #forget(attachmentId: string): void {
    const entry = this.#entries.get(attachmentId);
    if (entry === undefined) return;
    this.#entries.delete(attachmentId);
    this.#totalBytes -= entry.attachment.size;
  }

  #ensureCapacity(incomingBytes: number): void {
    while (
      this.#entries.size >= MAX_AGENT_HISTORY_IMAGES ||
      this.#totalBytes + incomingBytes > MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES
    ) {
      const oldestId = this.#entries.keys().next().value;
      if (oldestId === undefined) return;
      // 磁盘正文由 Thread 元数据管理；LRU 仅淘汰内存授权缓存。
      this.#forget(oldestId);
    }
  }
}
