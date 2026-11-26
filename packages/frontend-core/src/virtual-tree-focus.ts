/** 虚拟行挂载前无法聚焦；只完成键盘请求指定的目标，避免初次渲染或普通滚动抢走输入焦点。 */
export function focusMountedVirtualTreeRow(
  row: HTMLElement | null,
  itemId: string,
  pending: { current: string | null },
): void {
  if (!row || pending.current !== itemId) return;
  const target = row.querySelector<HTMLElement>('[role="treeitem"]');
  if (!target) return;
  pending.current = null;
  const active = row.ownerDocument.activeElement;
  // 请求尚未完成时用户若已移到其他输入区，不能在迟到挂载时夺回焦点。
  if (
    active &&
    active !== row.ownerDocument.body &&
    !row.closest('[role="tree"]')?.contains(active)
  )
    return;
  target.focus({ preventScroll: true });
}
