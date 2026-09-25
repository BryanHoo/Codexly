import type {
  AgentMessageAttachment,
  OpenProjectRequest,
  ProjectOpenAppId,
  ProjectOpenPlatform,
} from "@/protocol/index.js";

export type ProjectFileReferenceKind = "image" | "source" | "system";

export const MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES = 1024 * 1024;

export type ProjectPathOpenInput = Readonly<{
  appId: ProjectOpenAppId;
  fallbackToExistingAncestor?: boolean;
  path: string | undefined;
}>;

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

export function getProjectFileContainingFolderPath(path: string): string | undefined {
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (lastSeparator < 0) return undefined;
  if (lastSeparator === 0) return path.slice(0, 1);
  // Windows 盘符根目录必须保留末尾分隔符，否则会被解释为当前盘符工作目录。
  if (lastSeparator === 2 && /^[a-z]:[\\/]$/iu.test(path.slice(0, 3))) {
    return path.slice(0, 3);
  }
  return path.slice(0, lastSeparator);
}

export function getProjectFileManagerOpenPath(
  path: string,
  platform: ProjectOpenPlatform,
): string | undefined {
  // Finder 使用 `open -R <file>` 定位文件，其他平台直接打开父目录。
  return platform === "darwin" ? path : getProjectFileContainingFolderPath(path);
}

export function createProjectOpenRequest(
  input: ProjectPathOpenInput,
  taskId: string | undefined,
): OpenProjectRequest {
  return {
    appId: input.appId,
    ...(input.fallbackToExistingAncestor === undefined
      ? {}
      : { fallbackToExistingAncestor: input.fallbackToExistingAncestor }),
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(taskId === undefined ? {} : { taskId }),
  };
}

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
