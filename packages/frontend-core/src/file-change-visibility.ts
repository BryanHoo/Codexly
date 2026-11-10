type FileChange = Readonly<{
  kind: string;
  diff: string;
  stats?: Readonly<{ additions: number; removals: number }>;
  truncated?: boolean;
}>;

/** 仅用于正文已加载的记录；Git 轻量摘要的空串表示尚未读取，不能据此隐藏文件。 */
export function isEmptyFileUpdate(change: FileChange): boolean {
  // 新建/删除空文件、二进制、权限或重命名仍是真实变更；截断正文也不能当作无修改。
  if (change.kind !== "update" || change.truncated === true) return false;
  if (change.stats && (change.stats.additions !== 0 || change.stats.removals !== 0)) return false;
  return change.diff === "" || /^--- [^\r\n]+\r?\n\+\+\+ [^\r\n]+\r?\n?$/u.test(change.diff);
}
