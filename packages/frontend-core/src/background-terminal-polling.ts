// 已知终端保持及时刷新；空列表只低频发现新终端，避免运行中持续查询空结果。
export function getBackgroundTerminalPollInterval(
  isTaskRunning: boolean,
  terminalCount: number,
): number | false {
  if (terminalCount > 0) return 1_500;
  return isTaskRunning ? 10_000 : false;
}

export function shouldRefreshBackgroundTerminals(
  enabled: boolean,
  previousTaskRunning: boolean,
  isTaskRunning: boolean,
  taskId: string | undefined,
): boolean {
  // 回合开始和结束时立即校准，不等待低频发现计时器。
  return enabled && taskId !== undefined && previousTaskRunning !== isTaskRunning;
}
