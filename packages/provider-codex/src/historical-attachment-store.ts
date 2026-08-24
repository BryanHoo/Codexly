import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";

import type { AgentProviderAttachment } from "@code-agent/core";
import {
  MAX_AGENT_HISTORY_IMAGES,
  MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
  type AgentAttachmentKind,
  type AgentAttachmentMediaType,
  type AgentImageMediaType,
  type AgentMessageAttachment,
} from "@code-agent/protocol";

import {
  detectImageMediaType,
  imageExtensionsByMediaType,
  imageMediaTypesByExtension,
  normalizeAttachmentName,
  readFileHeader,
  readFileStats,
  readFileStatsAsync,
  type HistoricalFileStats,
} from "./historical-attachment-files.js";
import {
  addHistoricalLocalFile,
  type StoredHistoricalAttachment,
} from "./historical-local-file-attachment.js";
import { addHistoricalText } from "./historical-text-attachment.js";
import type { StagedImageAttachment } from "./jsonl-frame-processor.js";

const DEFAULT_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = MAX_AGENT_HISTORY_IMAGES;
const DEFAULT_MAX_TOTAL_BYTES = MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES;
const DATA_URL_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;

export interface CodexHistoricalAttachmentStoreOptions {
  attachmentDirectory?: string;
  cleanupIntervalMs?: number;
  clock?: () => number;
  createId?: () => string;
  maxBytes?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  readFile?: (path: string) => Promise<Buffer>;
  readHeader?: (path: string) => Buffer;
  readStats?: (path: string) => Promise<HistoricalFileStats>;
  statFile?: (path: string) => HistoricalFileStats;
  ttlMs?: number;
}

export class CodexHistoricalAttachmentStore {
  readonly #attachmentDirectory: string;
  readonly #clock: () => number;
  readonly #cleanupTimer: ReturnType<typeof setInterval>;
  readonly #createId: () => string;
  readonly #entries = new Map<string, StoredHistoricalAttachment>();
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxTotalBytes: number;
  readonly #readFile: (path: string) => Promise<Buffer>;
  readonly #readHeader: (path: string) => Buffer;
  readonly #readStats: (path: string) => Promise<HistoricalFileStats>;
  readonly #statFile: (path: string) => HistoricalFileStats;
  readonly #ttlMs: number;
  #disposed = false;
  #totalBytes = 0;

  public constructor(options: CodexHistoricalAttachmentStoreOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#maxBytes = options.maxBytes ?? MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.#readFile = options.readFile ?? readFile;
    this.#readHeader = options.readHeader ?? readFileHeader;
    this.#readStats = options.readStats ?? readFileStatsAsync;
    this.#statFile = options.statFile ?? readFileStats;
    this.#ttlMs = options.ttlMs ?? DEFAULT_ATTACHMENT_TTL_MS;
    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    for (const [name, value] of [
      ["cleanupIntervalMs", cleanupIntervalMs],
      ["maxBytes", this.#maxBytes],
      ["maxEntries", this.#maxEntries],
      ["maxTotalBytes", this.#maxTotalBytes],
      ["ttlMs", this.#ttlMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
    this.#attachmentDirectory =
      options.attachmentDirectory ?? mkdtempSync(join(tmpdir(), "code-agent-history-"));
    mkdirSync(this.#attachmentDirectory, { recursive: true });
    this.#cleanupTimer = setInterval(() => {
      this.#pruneExpired();
    }, cleanupIntervalMs);
    this.#cleanupTimer.unref();
  }

  public addDataUrl(
    taskId: string,
    input: Readonly<{ name?: string; url: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    const match = DATA_URL_PATTERN.exec(input.url);
    const encoded = match?.[2];
    const declaredMediaType = match?.[1] as AgentImageMediaType | undefined;
    if (
      encoded === undefined ||
      declaredMediaType === undefined ||
      encoded.length > Math.ceil((this.#maxBytes * 4) / 3) + 4
    ) {
      return undefined;
    }
    const content = this.#decodeBase64Image(encoded);
    if (content === undefined || detectImageMediaType(content) !== declaredMediaType) {
      return undefined;
    }
    const name = normalizeAttachmentName(input.name, `图片-${String(imageIndex + 1)}`);
    return this.#addInlineImage(taskId, content, declaredMediaType, name);
  }

  public addBase64Image(
    taskId: string,
    input: Readonly<{ encoded: string; name?: string }>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    const content = this.#decodeBase64Image(input.encoded);
    if (content === undefined) {
      return undefined;
    }
    const mediaType = detectImageMediaType(content);
    if (mediaType === undefined) {
      return undefined;
    }
    const name = normalizeAttachmentName(
      input.name,
      `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[mediaType]}`,
    );
    return this.#addInlineImage(taskId, content, mediaType, name);
  }

  public addStagedImage(
    taskId: string,
    staged: StagedImageAttachment,
    imageIndex: number,
    inputName?: string,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    if (staged.size > this.#maxBytes) return undefined;
    const name = normalizeAttachmentName(
      inputName,
      `生成图片-${String(imageIndex + 1)}${imageExtensionsByMediaType[staged.mediaType]}`,
    );
    for (const entry of this.#entries.values()) {
      if (
        entry.source === "managed" &&
        entry.projectTaskId === taskId &&
        entry.attachment.mediaType === staged.mediaType &&
        entry.attachment.name === name &&
        entry.attachment.size === staged.size &&
        entry.contentDigest === staged.contentDigest
      ) {
        try {
          unlinkSync(staged.path);
        } catch {
          // 重复项已由 Store 持有，暂存文件清理失败不影响既有授权。
        }
        return this.#refresh(entry);
      }
    }
    const attachment = this.#createAttachment("image", staged.mediaType, name, staged.size);
    if (attachment === undefined) return undefined;
    this.#ensureCapacity(attachment.size);
    const path = this.#managedPath(attachment.id);
    try {
      // Worker 已完成正文验证和写盘；主线程只原子移动文件并登记授权元数据。
      renameSync(staged.path, path);
    } catch {
      return undefined;
    }
    this.#entries.set(attachment.id, {
      attachment,
      contentDigest: staged.contentDigest,
      expiresAt: this.#clock() + this.#ttlMs,
      path,
      projectTaskId: taskId,
      source: "managed",
    });
    this.#totalBytes += attachment.size;
    return attachment;
  }

  #addInlineImage(
    taskId: string,
    content: Buffer,
    mediaType: AgentImageMediaType,
    name: string,
  ): AgentMessageAttachment | undefined {
    const contentDigest = createHash("sha256").update(content).digest("hex");
    for (const entry of this.#entries.values()) {
      if (
        entry.source === "managed" &&
        entry.projectTaskId === taskId &&
        entry.attachment.mediaType === mediaType &&
        entry.attachment.name === name &&
        entry.attachment.size === content.byteLength &&
        entry.contentDigest === contentDigest
      ) {
        // 重复 Snapshot 继续使用同一随机授权 ID，避免旧页面引用被后续读取立即作废。
        return this.#refresh(entry);
      }
    }
    return this.#addManagedAttachment(taskId, "image", mediaType, name, content, contentDigest);
  }

  #decodeBase64Image(encoded: string): Buffer | undefined {
    if (encoded.length === 0 || encoded.length > Math.ceil((this.#maxBytes * 4) / 3) + 4) {
      return undefined;
    }
    const content = Buffer.from(encoded, "base64");
    return content.byteLength === 0 ||
      content.byteLength > this.#maxBytes ||
      content.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")
      ? undefined
      : content;
  }

  public addLocalImage(
    taskId: string,
    path: string,
    imageIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    if (!isAbsolute(path)) {
      return undefined;
    }
    try {
      const stats = this.#statFile(path);
      if (!stats.isFile || stats.size <= 0 || stats.size > this.#maxBytes) {
        return undefined;
      }
      const mediaType = detectImageMediaType(this.#readHeader(path));
      if (mediaType === undefined) {
        return undefined;
      }
      const nativeName = basename(path);
      const expectedMediaType = imageMediaTypesByExtension[extname(nativeName).toLowerCase()];
      const name = normalizeAttachmentName(
        expectedMediaType === mediaType ? nativeName : undefined,
        `图片-${String(imageIndex + 1)}`,
      );
      for (const entry of this.#entries.values()) {
        if (
          entry.source === "local" &&
          entry.projectTaskId === taskId &&
          entry.attachment.mediaType === mediaType &&
          entry.attachment.name === name &&
          entry.attachment.size === stats.size &&
          entry.mtimeMs === stats.mtimeMs &&
          entry.path === path
        ) {
          return this.#refresh(entry);
        }
      }
      const attachment = this.#createAttachment("image", mediaType, name, stats.size);
      if (attachment === undefined) {
        return undefined;
      }
      this.#ensureCapacity(attachment.size);
      this.#entries.set(attachment.id, {
        attachment,
        expiresAt: this.#clock() + this.#ttlMs,
        mtimeMs: stats.mtimeMs,
        path,
        projectTaskId: taskId,
        source: "local",
      });
      this.#totalBytes += attachment.size;
      return attachment;
    } catch {
      // Codex 临时文件可能已被清理，单张图片不可用不应中断历史读取。
      return undefined;
    }
  }

  public addText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    return addHistoricalText({
      addManaged: (name, content, contentDigest) =>
        this.#addManagedAttachment(taskId, "text", "text/plain", name, content, contentDigest),
      entries: this.#entries.values(),
      input,
      refresh: (entry) => this.#refresh(entry),
      taskId,
      textIndex,
    });
  }

  public addLocalFile(
    taskId: string,
    input: Readonly<{ mediaType: string; name: string; path: string }>,
  ): AgentMessageAttachment | undefined {
    this.#pruneExpired();
    return addHistoricalLocalFile({
      clock: this.#clock,
      createAttachment: (kind, mediaType, name, size) =>
        this.#createAttachment(kind, mediaType, name, size),
      ensureCapacity: this.#ensureCapacity.bind(this),
      entries: this.#entries.values(),
      input,
      maxBytes: this.#maxBytes,
      refresh: (entry) => this.#refresh(entry),
      register: (entry) => {
        this.#entries.set(entry.attachment.id, entry);
        this.#totalBytes += entry.attachment.size;
      },
      statFile: this.#statFile,
      taskId,
      ttlMs: this.#ttlMs,
    });
  }

  #addManagedAttachment(
    taskId: string,
    kind: AgentAttachmentKind,
    mediaType: AgentAttachmentMediaType,
    name: string,
    content: Buffer,
    contentDigest: string,
  ): AgentMessageAttachment | undefined {
    const attachment = this.#createAttachment(kind, mediaType, name, content.byteLength);
    if (attachment === undefined) {
      return undefined;
    }
    this.#ensureCapacity(attachment.size);
    const path = this.#managedPath(attachment.id);
    try {
      // 授权 ID 和原始名称都不直接成为文件名，磁盘路径始终由 Store 控制。
      writeFileSync(path, content, { flag: "wx" });
    } catch {
      return undefined;
    }
    this.#entries.set(attachment.id, {
      attachment,
      contentDigest,
      expiresAt: this.#clock() + this.#ttlMs,
      path,
      projectTaskId: taskId,
      source: "managed",
    });
    this.#totalBytes += attachment.size;
    return attachment;
  }

  public async read(
    taskId: string,
    attachmentId: string,
  ): Promise<AgentProviderAttachment | undefined> {
    this.#pruneExpired();
    const entry = this.#entries.get(attachmentId);
    if (entry?.projectTaskId !== taskId) {
      return undefined;
    }
    try {
      if (entry.source === "local") {
        // Codex 本地源文件在正文读取前复验，避免路径内容变化后继续沿用旧授权。
        const stats = await this.#readStats(entry.path);
        if (
          !stats.isFile ||
          stats.size !== entry.attachment.size ||
          stats.mtimeMs !== entry.mtimeMs
        ) {
          this.#delete(attachmentId);
          return undefined;
        }
      }
      const content = await this.#readFile(entry.path);
      if (
        content.byteLength !== entry.attachment.size ||
        (entry.attachment.kind === "image" &&
          detectImageMediaType(content) !== entry.attachment.mediaType)
      ) {
        this.#delete(attachmentId);
        return undefined;
      }
      this.#touch(entry);
      return { ...entry.attachment, content };
    } catch {
      this.#delete(attachmentId);
      return undefined;
    }
  }

  public clearTask(taskId: string): void {
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.projectTaskId === taskId) {
        this.#delete(attachmentId);
      }
    }
  }

  public clear(): void {
    for (const attachmentId of [...this.#entries.keys()]) {
      this.#delete(attachmentId);
    }
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    clearInterval(this.#cleanupTimer);
    this.clear();
    rmSync(this.#attachmentDirectory, { force: true, recursive: true });
  }

  #refresh(entry: StoredHistoricalAttachment): AgentMessageAttachment {
    this.#touch({
      ...entry,
      expiresAt: this.#clock() + this.#ttlMs,
    });
    return entry.attachment;
  }

  #touch(entry: StoredHistoricalAttachment): void {
    this.#entries.delete(entry.attachment.id);
    this.#entries.set(entry.attachment.id, entry);
  }

  #createAttachment(
    kind: AgentAttachmentKind,
    mediaType: AgentAttachmentMediaType,
    name: string,
    size: number,
  ): AgentMessageAttachment | undefined {
    if (this.#disposed || size > this.#maxTotalBytes) {
      return undefined;
    }
    const id = this.#createId();
    if (id.length === 0 || this.#entries.has(id)) {
      return undefined;
    }
    return { id, kind, mediaType, name, size };
  }

  #managedPath(attachmentId: string): string {
    return join(this.#attachmentDirectory, createHash("sha256").update(attachmentId).digest("hex"));
  }

  #delete(attachmentId: string): void {
    const entry = this.#entries.get(attachmentId);
    if (entry !== undefined) {
      this.#entries.delete(attachmentId);
      this.#totalBytes -= entry.attachment.size;
      if (entry.source === "managed") {
        try {
          unlinkSync(entry.path);
        } catch {
          // 文件可能已被外部临时目录清理；授权状态仍必须同步移除。
        }
      }
    }
  }

  #ensureCapacity(incomingBytes: number): void {
    while (
      this.#entries.size >= this.#maxEntries ||
      this.#totalBytes + incomingBytes > this.#maxTotalBytes
    ) {
      const leastRecentlyUsedId = this.#entries.keys().next().value;
      if (leastRecentlyUsedId === undefined) {
        return;
      }
      this.#delete(leastRecentlyUsedId);
    }
  }

  #pruneExpired(): void {
    const now = this.#clock();
    for (const [attachmentId, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#delete(attachmentId);
      }
    }
  }
}
