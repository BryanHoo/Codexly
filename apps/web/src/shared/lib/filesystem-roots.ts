import type { FilesystemRoot } from "@codexly/protocol";
import { isWindowsHostPath, normalizeHostPath } from "@codexly/frontend-core/host-path";

export function findActiveFilesystemRoot(
  roots: readonly FilesystemRoot[],
  path: string,
): FilesystemRoot | undefined {
  let active: FilesystemRoot | undefined;
  let longest = -1;
  for (const root of roots) {
    const windows = isWindowsHostPath(root.path);
    const normalize = (value: string) => {
      const normalized = normalizeHostPath(value, windows);
      return windows ? normalized.toLowerCase() : normalized;
    };
    const prefix = normalize(root.path);
    const current = normalize(path);
    // 必须命中完整目录边界；多个授权根嵌套时选择最具体的根，不能由列表顺序决定。
    if (
      prefix.length > longest &&
      (current === prefix || current.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
    ) {
      active = root;
      longest = prefix.length;
    }
  }
  return active;
}
