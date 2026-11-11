import { extname } from "node:path";
import {
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachmentKind,
  type AgentImageMediaType,
} from "@codexly/protocol";
import type { AttachmentUploadInput } from "./attachment-store-types.js";

const IMAGE_EXTENSIONS = new Map<AgentImageMediaType, string>([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export function maximumBytesFor(kind: AgentAttachmentKind): number {
  if (kind === "image") {
    return MAX_AGENT_IMAGE_BYTES;
  }
  return kind === "text" ? MAX_AGENT_TEXT_BYTES : MAX_AGENT_FILE_BYTES;
}

export function validateUploadMetadata(input: AttachmentUploadInput): string {
  if (input.name.length === 0 || input.name.length > 255 || input.mediaType.length > 255) {
    throw new TypeError("Attachment metadata is invalid");
  }
  if (input.kind === "image") {
    const extension = IMAGE_EXTENSIONS.get(input.mediaType as AgentImageMediaType);
    if (extension === undefined) {
      throw new TypeError("Attachment image type is unsupported");
    }
    return extension;
  }
  if (input.kind === "text") {
    if (input.mediaType !== "text/plain") {
      throw new TypeError("Generated text attachment must use text/plain");
    }
    return ".txt";
  }
  const extension = extname(input.name).toLowerCase();
  // 普通文件不解析内容，保留后缀落盘后由 Provider 作为本地路径交给 Codex。
  return extension;
}
