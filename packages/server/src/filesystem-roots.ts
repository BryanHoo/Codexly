import { access } from "node:fs/promises";

import type { FilesystemRoot } from "@codexly/protocol";

type FilesystemRootOptions = Readonly<{
  accessPath?: (path: string) => Promise<void>;
  platform?: NodeJS.Platform;
}>;

export async function listFilesystemRoots(
  options: FilesystemRootOptions = {},
): Promise<FilesystemRoot[]> {
  if ((options.platform ?? process.platform) !== "win32") return [];

  const accessPath = options.accessPath ?? access;
  const candidates = Array.from({ length: 26 }, (_, index) => {
    const name = `${String.fromCharCode(65 + index)}:`;
    return { name, path: `${name}\\` };
  });
  const available = await Promise.all(
    candidates.map(async (root) => {
      try {
        await accessPath(root.path);
        return root;
      } catch {
        return null;
      }
    }),
  );

  // 保持盘符字母顺序，确保不同请求和两个选择器展示一致。
  return available.filter((root): root is FilesystemRoot => root !== null);
}
