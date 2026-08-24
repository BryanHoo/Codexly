import { isAbsolute } from "node:path";

import type {
  AgentAttachmentKind,
  AgentAttachmentMediaType,
  AgentMessageAttachment,
} from "@code-agent/protocol";

import {
  normalizeAttachmentName,
  type HistoricalFileStats,
} from "./historical-attachment-files.js";

type StoredAttachmentBase = Readonly<{
  attachment: AgentMessageAttachment;
  expiresAt: number;
  projectTaskId: string;
}>;

export type StoredHistoricalAttachment =
  | (StoredAttachmentBase & Readonly<{ contentDigest: string; path: string; source: "managed" }>)
  | (StoredAttachmentBase & Readonly<{ mtimeMs: number; path: string; source: "local" }>);

type AddLocalFileOptions = Readonly<{
  clock: () => number;
  createAttachment: (
    kind: AgentAttachmentKind,
    mediaType: AgentAttachmentMediaType,
    name: string,
    size: number,
  ) => AgentMessageAttachment | undefined;
  ensureCapacity: (size: number) => void;
  entries: Iterable<StoredHistoricalAttachment>;
  input: Readonly<{ mediaType: string; name: string; path: string }>;
  maxBytes: number;
  refresh: (entry: StoredHistoricalAttachment) => AgentMessageAttachment;
  register: (entry: StoredHistoricalAttachment) => void;
  statFile: (path: string) => HistoricalFileStats;
  taskId: string;
  ttlMs: number;
}>;

export function addHistoricalLocalFile({
  clock,
  createAttachment,
  ensureCapacity,
  entries,
  input,
  maxBytes,
  refresh,
  register,
  statFile,
  taskId,
  ttlMs,
}: AddLocalFileOptions): AgentMessageAttachment | undefined {
  if (!isAbsolute(input.path)) {
    return undefined;
  }
  try {
    const stats = statFile(input.path);
    if (!stats.isFile || stats.size <= 0 || stats.size > maxBytes) {
      return undefined;
    }
    const name = normalizeAttachmentName(input.name, "Attachment");
    for (const entry of entries) {
      if (
        entry.source === "local" &&
        entry.projectTaskId === taskId &&
        entry.attachment.kind === "file" &&
        entry.attachment.mediaType === input.mediaType &&
        entry.attachment.name === name &&
        entry.attachment.size === stats.size &&
        entry.mtimeMs === stats.mtimeMs &&
        entry.path === input.path
      ) {
        return refresh(entry);
      }
    }
    const attachment = createAttachment("file", input.mediaType, name, stats.size);
    if (attachment === undefined) {
      return undefined;
    }
    ensureCapacity(attachment.size);
    register({
      attachment,
      expiresAt: clock() + ttlMs,
      mtimeMs: stats.mtimeMs,
      path: input.path,
      projectTaskId: taskId,
      source: "local",
    });
    return attachment;
  } catch {
    return undefined;
  }
}
