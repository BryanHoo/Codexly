import type { AgentMessageAttachment } from "@codexly/protocol";

export type ProjectFileReferenceKind = "image" | "source" | "system";

export const MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES = 1024 * 1024;

const IMAGE_PREVIEW_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

const SYSTEM_OPEN_EXTENSIONS = new Set([
  "7z",
  "avi",
  "dmg",
  "doc",
  "docm",
  "docx",
  "exe",
  "gz",
  "key",
  "mov",
  "mp3",
  "mp4",
  "numbers",
  "odp",
  "ods",
  "odt",
  "pages",
  "pdf",
  "pkg",
  "ppt",
  "pptm",
  "pptx",
  "rar",
  "tar",
  "tgz",
  "wav",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "zip",
]);

export function classifyProjectFileReference(path: string): ProjectFileReferenceKind {
  const fileName = path.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".") ? (fileName.split(".").at(-1) ?? "") : "";
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (SYSTEM_OPEN_EXTENSIONS.has(extension)) {
    return "system";
  }
  // 未知文本格式仍交给受控源文件读取，Server 会拒绝二进制内容。
  return "source";
}

export function classifyMessageAttachment(
  attachment: AgentMessageAttachment,
): ProjectFileReferenceKind {
  if (attachment.kind === "image") {
    return "image";
  }
  if (attachment.kind === "text") {
    return "source";
  }
  // 超出受控源码弹窗读取上限的文件直接交给系统应用，避免打开后才显示失败。
  if (attachment.size > MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES) {
    return "system";
  }
  return classifyProjectFileReference(attachment.name) === "source" ? "source" : "system";
}
