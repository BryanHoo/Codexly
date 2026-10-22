import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

export function useDocumentTabScroll(
  ref: RefObject<HTMLDivElement | null>,
  activeId: string | null,
  count: number,
) {
  const enabled = count > 0;
  const reveal = useCallback(() => {
    const list = ref.current;
    const tab = list?.querySelector('[role="tab"][aria-selected="true"]')?.parentElement;
    if (list === null || tab === undefined || tab === null) return;
    // 只移动标签条，并将关闭按钮一起纳入可见区域，不滚动聊天或外层工作台。
    const bounds = list.getBoundingClientRect();
    const target = tab.getBoundingClientRect();
    list.scrollLeft += target.left + target.width / 2 - bounds.left - list.clientWidth / 2;
  }, [ref]);
  useLayoutEffect(reveal, [reveal, activeId, count]);
  useEffect(() => {
    const list = ref.current;
    if (!enabled || list === null) return;
    const onWheel = (event: WheelEvent) => {
      // 滚轮和触控板统一采用主轴增量，避免斜向手势双倍加速；缩放和触摸拖动不拦截。
      if (event.ctrlKey || event.metaKey) return;
      const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
      const previous = list.scrollLeft;
      list.scrollLeft += delta * unit;
      if (list.scrollLeft !== previous) event.preventDefault();
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    let width = list.clientWidth;
    const observer = new ResizeObserver(() => {
      if (list.clientWidth === width) return;
      width = list.clientWidth;
      reveal();
    });
    observer.observe(list);
    return () => {
      list.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [enabled, ref, reveal]);
  return reveal;
}
