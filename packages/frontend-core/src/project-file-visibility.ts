// 只隐藏操作系统生成的元数据，不屏蔽 .env、.gitignore 等有业务意义的隐藏文件。
const systemMetadataNames = new Set([
  ".ds_store",
  "thumbs.db",
  "ehthumbs.db",
  "ehthumbs_vista.db",
  "desktop.ini",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  ".temporaryitems",
  "__macosx",
]);

export function isVisibleProjectPath(path: string): boolean {
  // 同时识别 POSIX 与 Windows 分隔符，元数据目录下的内容也不进入项目或变更列表。
  return !path
    .split(/[\\/]/u)
    .some((segment) => systemMetadataNames.has(segment.toLowerCase()) || segment.startsWith("._"));
}

export function filterVisibleProjectFiles<T extends Readonly<{ path: string }>>(
  files: readonly T[],
): T[] {
  return files.filter((file) => isVisibleProjectPath(file.path));
}
