import type { Buffer } from "node:buffer";
import type { Readable } from "node:stream";

import type {
  AgentAttachment,
  AgentAttachmentKind,
  AgentAttachmentMediaType,
  AgentImageMediaType,
} from "@code-agent/protocol";

export interface AttachmentStoreOptions {
  attachmentDirectory?: string;
  clock?: () => number;
  createId?: () => string;
  maxBytes?: number;
  maxEntries?: number;
  maxTotalBytes?: number;
  ttlMs?: number;
}

export type AttachmentUploadInput = Readonly<{
  content: Readable;
  kind: AgentAttachmentKind;
  mediaType: AgentAttachmentMediaType;
  name: string;
}>;

export type StoredAttachmentUpload = Readonly<{
  attachment: AgentAttachment;
  contentDigest: string;
}>;

export type StoredAttachmentContent = Readonly<{
  attachment: AgentAttachment;
  content: Buffer;
}>;

export type ResolvedAttachment =
  | Readonly<{
      kind: "file";
      mediaType: AgentAttachmentMediaType;
      name: string;
      path: string;
      size: number;
    }>
  | Readonly<{
      kind: "image";
      mediaType: AgentImageMediaType;
      size: number;
      url: string;
    }>
  | Readonly<{ kind: "text"; mediaType: "text/plain"; name: string; size: number; text: string }>;
