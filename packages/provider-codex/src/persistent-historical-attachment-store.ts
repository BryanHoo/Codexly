import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import type { AgentProviderAttachment } from "@codexly/core";
import {
  MAX_AGENT_HISTORY_IMAGES,
  MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachmentKind,
  type AgentAttachmentMediaType,
  type AgentImageMediaType,
  type AgentMessageAttachment,
} from "@codexly/protocol";

import {
  detectImageMediaType,
  imageExtensionsByMediaType,
  normalizeAttachmentName,
} from "./historical-attachment-files.js";
import type { StagedImageAttachment } from "./jsonl-frame-processor.js";
import type { CodexlyThreadAttachmentMetadata } from "./thread-attachment-repository.js";

const DATA_URL_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

type PersistentEntry = Readonly<{
  attachment: AgentMessageAttachment;
  blobKey: string;
  path: string;
  taskId: string;
}>;

export interface HistoricalAttachmentStore {
  addBase64Image(
    taskId: string,
    input: Readonly<{ encoded: string; name?: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined;
  addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined;
  addLocalFile(
    taskId: string,
    input: Readonly<{ mediaType: string; name: string; path: string }>,
  ): AgentMessageAttachment | undefined;
  addLocalImage(
    taskId: string,
    path: string,
    imageIndex: number,
  ): AgentMessageAttachment | undefined;
  addStagedImage(
    taskId: string,
    staged: StagedImageAttachment,
    imageIndex: number,
    inputName?: string,
  ): AgentMessageAttachment | undefined;
  addText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined;
  clearTask(taskId: string): void;
  dispose(): void;
  read(taskId: string, attachmentId: string): Promise<AgentProviderAttachment | undefined>;
}

export class CodexPersistentHistoricalAttachmentStore implements HistoricalAttachmentStore {
  readonly #entries = new Map<string, PersistentEntry>();
  readonly #pending = new Map<string, Map<string, CodexlyThreadAttachmentMetadata>>();
  #totalBytes = 0;

  public constructor(private readonly directory: string) {
    // 目录按首个附件延迟创建，仅读取 Thread 不产生空的本地状态。
  }

  public addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    const match = DATA_URL_PATTERN.exec(input.url);
    const mediaType = match?.[1] as AgentImageMediaType | undefined;
    const content = this.#decodeBase64(match?.[2]);
    if (
      content === undefined ||
      mediaType === undefined ||
      detectImageMediaType(content) !== mediaType
    ) {
      return undefined;
    }
    return this.#add(
      taskId,
      "image",
      mediaType,
      normalizeAttachmentName(input.name, `图片-${String(imageIndex + 1)}`),
      content,
    );
  }

  public addBase64Image(
    taskId: string,
    input: Readonly<{ encoded: string; name?: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    const content = this.#decodeBase64(input.encoded);
    const mediaType = content === undefined ? undefined : detectImageMediaType(content);
    if (content === undefined || mediaType === undefined) return undefined;
    return this.#add(
      taskId,
      "image",
      mediaType,
      normalizeAttachmentName(
        input.name,
        `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[mediaType]}`,
      ),
      content,
    );
  }

  public addStagedImage(
    taskId: string,
    staged: StagedImageAttachment,
    imageIndex: number,
    inputName?: string,
  ): AgentMessageAttachment | undefined {
    if (staged.size <= 0 || staged.size > MAX_AGENT_IMAGE_BYTES) return undefined;
    try {
      const content = readFileSync(staged.path);
      if (
        content.byteLength !== staged.size ||
        createHash("sha256").update(content).digest("hex") !== staged.contentDigest ||
        detectImageMediaType(content) !== staged.mediaType
      ) {
        return undefined;
      }
      const attachment = this.#add(
        taskId,
        "image",
        staged.mediaType,
        normalizeAttachmentName(
          inputName,
          `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[staged.mediaType]}`,
        ),
        content,
      );
      if (attachment !== undefined) unlinkSync(staged.path);
      return attachment;
    } catch {
      return undefined;
    }
  }

  public addLocalImage(
    taskId: string,
    path: string,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    if (!isAbsolute(path)) return undefined;
    try {
      const stats = statSync(path);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_AGENT_IMAGE_BYTES)
        return undefined;
      const content = readFileSync(path);
      const mediaType = detectImageMediaType(content);
      if (mediaType === undefined) return undefined;
      return this.#add(
        taskId,
        "image",
        mediaType,
        normalizeAttachmentName(basename(path), `图片-${String(imageIndex + 1)}`),
        content,
      );
    } catch {
      return undefined;
    }
  }

  public addText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined {
    const content = Buffer.from(input.text, "utf8");
    if (content.byteLength > MAX_AGENT_TEXT_BYTES) return undefined;
    return this.#add(
      taskId,
      "text",
      "text/plain",
      normalizeAttachmentName(input.name, `Pasted text-${String(textIndex + 1)}.txt`),
      content,
    );
  }

  public addLocalFile(
    taskId: string,
    input: Readonly<{ mediaType: string; name: string; path: string }>,
  ): AgentMessageAttachment | undefined {
    if (!isAbsolute(input.path)) return undefined;
    try {
      const stats = statSync(input.path);
      if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_AGENT_FILE_BYTES) return undefined;
      return this.#add(
        taskId,
        "file",
        input.mediaType,
        normalizeAttachmentName(input.name, "Attachment"),
        readFileSync(input.path),
      );
    } catch {
      return undefined;
    }
  }

  public restoreTask(taskId: string, metadata: readonly CodexlyThreadAttachmentMetadata[]): void {
    this.clearTask(taskId);
    for (const record of metadata) {
      const path = this.#blobPath(taskId, record.blobKey);
      try {
        const stats = statSync(path);
        if (!stats.isFile() || stats.size !== record.attachment.size) continue;
        this.#register({ attachment: record.attachment, blobKey: record.blobKey, path, taskId });
      } catch {
        // 元数据与正文可能被独立清理；缺失正文不再授权下载。
      }
    }
  }

  public pendingMetadata(taskId: string): readonly CodexlyThreadAttachmentMetadata[] {
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
    const entry = this.#entries.get(attachmentId);
    if (entry?.taskId !== taskId) return undefined;
    try {
      const content = await readFile(entry.path);
      if (
        content.byteLength !== entry.attachment.size ||
        createHash("sha256").update(content).digest("hex") !== entry.blobKey ||
        (entry.attachment.kind === "image" &&
          detectImageMediaType(content) !== entry.attachment.mediaType)
      ) {
        this.#forget(attachmentId);
        rmSync(entry.path, { force: true });
        return undefined;
      }
      this.#touch(entry);
      return { ...entry.attachment, content };
    } catch {
      this.#forget(attachmentId);
      return undefined;
    }
  }

  public clearTask(taskId: string): void {
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.taskId === taskId) this.#forget(attachmentId);
    }
    this.#pending.delete(taskId);
  }

  public deleteTask(taskId: string): void {
    this.clearTask(taskId);
    rmSync(this.#taskDirectory(taskId), { force: true, recursive: true });
  }

  public dispose(): void {
    this.#entries.clear();
    this.#pending.clear();
    this.#totalBytes = 0;
  }

  #add(
    taskId: string,
    kind: AgentAttachmentKind,
    mediaType: AgentAttachmentMediaType,
    name: string,
    content: Buffer,
  ): AgentMessageAttachment | undefined {
    const maxBytes =
      kind === "image"
        ? MAX_AGENT_IMAGE_BYTES
        : kind === "text"
          ? MAX_AGENT_TEXT_BYTES
          : MAX_AGENT_FILE_BYTES;
    if (content.byteLength === 0 || content.byteLength > maxBytes) {
      return undefined;
    }
    const blobKey = createHash("sha256").update(content).digest("hex");
    const id = `history-${createHash("sha256")
      .update(JSON.stringify([taskId, kind, mediaType, name, content.byteLength, blobKey]))
      .digest("hex")}`;
    const existing = this.#entries.get(id);
    if (existing?.taskId === taskId) {
      this.#touch(existing);
      return existing.attachment;
    }
    const attachment = { id, kind, mediaType, name, size: content.byteLength } as const;
    const path = this.#blobPath(taskId, blobKey);
    mkdirSync(this.#taskDirectory(taskId), { recursive: true });
    if (!existsSync(path)) {
      const temporaryPath = `${path}.${process.pid.toString()}.${id}.tmp`;
      try {
        writeFileSync(temporaryPath, content, { flag: "wx" });
        renameSync(temporaryPath, path);
      } catch {
        rmSync(temporaryPath, { force: true });
        if (!existsSync(path)) return undefined;
      }
    }
    this.#ensureCapacity(attachment.size);
    this.#register({ attachment, blobKey, path, taskId });
    const taskPending =
      this.#pending.get(taskId) ?? new Map<string, CodexlyThreadAttachmentMetadata>();
    taskPending.set(id, { attachment, blobKey, schemaVersion: 1 });
    this.#pending.set(taskId, taskPending);
    return attachment;
  }

  #decodeBase64(encoded: string | undefined): Buffer | undefined {
    if (encoded === undefined || encoded.length === 0) return undefined;
    const content = Buffer.from(encoded, "base64");
    return content.byteLength === 0 ||
      content.byteLength > MAX_AGENT_IMAGE_BYTES ||
      content.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")
      ? undefined
      : content;
  }

  #taskDirectory(taskId: string): string {
    return join(this.directory, createHash("sha256").update(taskId).digest("hex"));
  }

  #blobPath(taskId: string, blobKey: string): string {
    return join(this.#taskDirectory(taskId), blobKey);
  }

  #register(entry: PersistentEntry): void {
    this.#entries.set(entry.attachment.id, entry);
    this.#totalBytes += entry.attachment.size;
  }

  #touch(entry: PersistentEntry): void {
    this.#entries.delete(entry.attachment.id);
    this.#entries.set(entry.attachment.id, entry);
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
