import type { FilesystemRoot } from "@code-agent/protocol";

export function findActiveFilesystemRoot(
  roots: readonly FilesystemRoot[],
  path: string,
): FilesystemRoot | undefined {
  // Windows 盘符大小写不敏感，统一折叠后再关联当前目录和盘符选择项。
  const normalizedPath = path.toLowerCase();
  return roots.find((root) => normalizedPath.startsWith(root.path.toLowerCase()));
}
