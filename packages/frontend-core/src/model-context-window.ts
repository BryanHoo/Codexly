export const MODEL_CONTEXT_WINDOW_MIN_K = 272;
export const MODEL_CONTEXT_WINDOW_MAX_K = 1000;

/** 解析两端共用的千 tokens 草稿：null 恢复自动，undefined 表示非法输入，禁止提交。 */
export function parseModelContextWindow(
  input: string,
  { minK = MODEL_CONTEXT_WINDOW_MIN_K, maxK = MODEL_CONTEXT_WINDOW_MAX_K } = {},
): number | null | undefined {
  const value = input.trim();
  if (value === "") return null;
  // 只接受十进制整数字符，避免指数、分组符和小数造成意外的容量覆盖。
  if (!/^\d+$/.test(value)) return undefined;
  const thousands = Number(value);
  // UI 按千 tokens 输入，写入官方配置前换算为 tokens；范围仅约束新输入，不改写已有配置。
  return Number.isInteger(thousands) &&
    thousands >= minK &&
    thousands <= maxK &&
    Number.isSafeInteger(thousands * 1000)
    ? thousands * 1000
    : undefined;
}
