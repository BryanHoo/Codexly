import type {
  OpenProjectRequest,
  ProjectOpenAppId,
  ProjectOpenPlatform,
} from "@/protocol/index.js";

export {
  classifyMessageAttachment,
  classifyProjectFileReference,
  MAX_MESSAGE_SOURCE_ATTACHMENT_BYTES,
  type ProjectFileReferenceKind,
} from "@codexly/frontend-core/project-file-reference";

export type ProjectPathOpenInput = Readonly<{
  appId: ProjectOpenAppId;
  fallbackToExistingAncestor?: boolean;
  path: string | undefined;
}>;

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
