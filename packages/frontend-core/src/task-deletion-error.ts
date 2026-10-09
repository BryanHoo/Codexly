// Codex 尚未提供专用错误码；严格匹配完整的删除保护错误，避免误改其他失败提示。
const FORK_HISTORY_DELETION_ERROR =
  /^cannot delete thread [^\s:]+: forked history still references it$/u;

/** 两端统一识别分叉历史依赖；只读取错误，保留原始内容供诊断使用。 */
export function isForkHistoryDeletionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : error;
  return typeof message === "string" && FORK_HISTORY_DELETION_ERROR.test(message.trim());
}
