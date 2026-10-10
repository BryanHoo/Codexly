export function restoreSplitPaneFocus(previous: HTMLElement | null): boolean {
  const pane = previous?.closest("[data-split-pane]");
  if (
    pane === undefined ||
    pane === null ||
    (previous?.isConnected && pane.getAttribute("data-active") === "true")
  )
    return false;
  const active = document.querySelector<HTMLElement>('[data-split-pane][data-active="true"]');
  if (active === null) return false;
  // 弹窗关闭不能通过旧输入框重新激活旧任务；恢复最新活动窗口并保持滚动位置。
  active.focus({ preventScroll: true });
  return true;
}
