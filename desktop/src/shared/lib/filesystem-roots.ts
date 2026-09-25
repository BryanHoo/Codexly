import type { FilesystemRoot } from "@/protocol/index.js";

function normalizeFilesystemPath(path: string): string {
  const normalizedPath = path.toLowerCase();
  // Windows canonicalize 会添加 \\?\ 前缀，UI 根项仍使用普通盘符路径。
  return normalizedPath.startsWith("\\\\?\\") ? normalizedPath.slice(4) : normalizedPath;
}

export function findActiveFilesystemRoot(
  roots: readonly FilesystemRoot[],
  path: string,
): FilesystemRoot | undefined {
  // Windows 盘符大小写不敏感，统一折叠后再关联当前目录和盘符选择项。
  const normalizedPath = normalizeFilesystemPath(path);
  return roots.find((root) => normalizedPath.startsWith(normalizeFilesystemPath(root.path)));
}
