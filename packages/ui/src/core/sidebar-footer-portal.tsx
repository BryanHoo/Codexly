/** Activity 暂停事件时会断开 ref，但不隐藏跨容器的 Portal；同步隐藏弹层节点，避免残留死浮层。 */
export function attachFooterPortal(node: HTMLDivElement | null) {
  if (!node) return;
  node.hidden = false;
  // 捕获节点供隐藏/卸载清理；恢复时重新连接同一 ref，不增加订阅、计时器或 React 状态。
  return () => {
    node.hidden = true;
  };
}
