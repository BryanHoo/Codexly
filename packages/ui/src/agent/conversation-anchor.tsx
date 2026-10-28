import { useLayoutEffect, useRef, type RefObject } from "react";
import { useMessageScroller } from "../core/message-scroller.js";

type LayoutActions = Readonly<{ pause: () => void; follow: () => void }>;
const idle = () => undefined;

/** 官方命令负责滚动；此适配在绘制前补齐布局，避免 WebKit 锚点缺失和 RO 延迟一帧造成跳动。 */
export function useConversationLayout(contentRef: RefObject<HTMLDivElement | null>) {
  const actions = useRef<LayoutActions>({ pause: idle, follow: idle });
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = content?.closest<HTMLDivElement>('[data-slot="message-scroller-viewport"]');
    if (!content || !viewport) return;
    let following = true;
    let anchor: { node: HTMLElement; top: number } | null = null;
    let frame = 0;
    let restoring = false;
    const capture = () => {
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24) {
        following = true;
        anchor = null;
        return;
      }
      if (following) return;
      const top = viewport.getBoundingClientRect().top;
      // 已加载回合有界；二分测量只读取对数个节点，滚动事件本身不更新 React。
      const rows = content.querySelectorAll<HTMLElement>('[data-conversation-row="turn"]');
      let low = 0;
      let high = rows.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const row = rows[mid];
        if (row !== undefined && row.getBoundingClientRect().bottom <= top) low = mid + 1;
        else high = mid;
      }
      const node = rows[low];
      anchor = node ? { node, top: node.getBoundingClientRect().top - top } : null;
    };
    const syncLayout = () => {
      if (following) {
        // 使用同一个官方状态机恢复底部，不额外维护动画或逐 token 的 React 状态。
        scrollToEnd({ behavior: "instant" });
        return;
      }
      if (!anchor?.node.isConnected) return;
      const delta =
        anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) < 1) return;
      restoring = true;
      viewport.scrollTop += delta;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        restoring = false;
      });
    };
    const onScroll = () => {
      if (restoring) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    const pause = () => {
      following = false;
      anchor = null;
    };
    const follow = () => {
      following = true;
      anchor = null;
      scrollToEnd({ behavior: "instant" });
    };
    const onPointerDown = (event: PointerEvent) => {
      // 拖动原生滚动条同样属于用户阅读意图，不依赖 wheel 才能暂停。
      if (event.target === viewport) pause();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        pause();
    };
    actions.current = { pause, follow };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", pause, { passive: true });
    viewport.addEventListener("touchmove", pause, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("pointerdown", onPointerDown);
    const resize = new ResizeObserver(syncLayout);
    resize.observe(content);
    const mutations = new MutationObserver(syncLayout);
    mutations.observe(content, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", pause);
      viewport.removeEventListener("touchmove", pause);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("pointerdown", onPointerDown);
      actions.current = { pause: idle, follow: idle };
    };
  }, [contentRef, scrollToEnd]);
  return actions;
}
