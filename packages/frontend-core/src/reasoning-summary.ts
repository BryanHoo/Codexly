export function hasReasoningSummary(summary: string | undefined): boolean {
  // 两端只在摘要含非空白文字时创建展示入口，流式占位仍保留在 Store 中等待后续增量。
  return (summary?.trim().length ?? 0) > 0;
}
