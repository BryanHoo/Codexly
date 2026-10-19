/** 访问策略与协议拒绝需要用户或资源状态变化，重复建立连接无法恢复。 */
export function shouldReconnectWebSocket(closeCode: number): boolean {
  return closeCode !== 1008 && closeCode !== 1002;
}

export function getWebSocketReconnectDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  // 先限制指数退避，再加入 ±20% 抖动；达到上限后仍打散多标签页的重连时间。
  const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** Math.min(attempt, 30));
  return delay * (0.8 + Math.random() * 0.4);
}
