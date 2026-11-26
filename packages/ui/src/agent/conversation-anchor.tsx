import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useMessageScroller } from "../core/message-scroller.js";

type LayoutActions = Readonly<{ pause: () => void; follow: () => void }>;
const idle = () => undefined;

/** 官方命令负责滚动；此适配在绘制前补齐布局，避免 WebKit 锚点缺失和 RO 延迟一帧造成跳动。 */
export function useConversationLayout(contentRef: RefObject<HTMLDivElement | null>) {
  const actions = useRef<LayoutActions>({ pause: idle, follow: idle });
  // Activity 隐藏会清理并重建 effect，但仍保留 ref；阅读状态必须跨这次重建保存。
  const reading = useRef<{
    following: boolean;
    anchor: { node: HTMLElement; top: number } | null;
    top: number;
  }>({ following: true, anchor: null, top: 0 });
  const restoreAction = useRef<() => void>(idle);
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = content?.closest<HTMLDivElement>('[data-slot="message-scroller-viewport"]');
    if (!content || !viewport) return;
    let following = reading.current.following;
    let anchor = reading.current.anchor;
    let top = reading.current.top;
    let frame = 0;
    let restoring = false;
    let turnRows: HTMLElement[] | undefined;
    let touchY: number | undefined;
    const resumeAtBottom = () => {
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 24) return false;
      following = true;
      anchor = null;
      return true;
    };
    const capture = () => {
      if (following || resumeAtBottom()) return;
      const top = viewport.getBoundingClientRect().top;
      // 回合是正文容器的直接子节点。行结构变化后才重建索引，滚动只二分测量节点。
      const rows = (turnRows ??= Array.from(content.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.dataset["conversationRow"] === "turn",
      ));
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
      if (viewport.clientHeight === 0) return;
      top = viewport.scrollTop;
      if (restoring || following) return;
      cancelAnimationFrame(frame);
      // 用户刚滚到底就恢复跟随，避免下一批卡片先增高列表，令下一帧读到过时的底部距离。
      if (!resumeAtBottom()) frame = requestAnimationFrame(capture);
    };
    const pause = () => {
      following = false;
      anchor = null;
    };
    const onReadingIntent = (event: Event) => {
      // 原生监听先于 React 冒泡执行；diff 内部阅读不能暂停外层会话跟随。
      // 使用 composedPath 兼容补丁渲染器的 Shadow DOM，不额外测量布局。
      if (
        event
          .composedPath()
          .some((node) => node instanceof Element && node.hasAttribute("data-file-diff-content"))
      )
        return;
      pause();
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
    const onWheel = (event: WheelEvent) => {
      // 已贴底时仍可能收到向下的惯性滚轮事件，此时没有 scroll 事件能重新启用跟随。
      if (!event.shiftKey && !event.ctrlKey && event.deltaY < 0) onReadingIntent(event);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    };
    const onTouchMove = (event: TouchEvent) => {
      const previousY = touchY;
      onTouchStart(event);
      // 单指向下拖动才是在查看较早的消息，向上拖动和双指缩放保留当前跟随状态。
      if (touchY !== undefined && previousY !== undefined && touchY > previousY) {
        onReadingIntent(event);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      )
        onReadingIntent(event);
    };
    actions.current = { pause, follow };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("pointerdown", onPointerDown);
    const resize = new ResizeObserver(syncLayout);
    resize.observe(content);
    // 输入框收起/展开或软键盘改变视口时也同步锚点，避免只等正文尺寸回调留下旧阅读位置。
    resize.observe(viewport);
    const mutations = new MutationObserver((records) => {
      // 流式正文会修改回合内部，只有容器直接增删子节点才使回合索引失效。
      if (turnRows !== undefined && records.some((record) => record.target === content)) {
        turnRows = undefined;
      }
      syncLayout();
    });
    mutations.observe(content, { childList: true, subtree: true });
    restoreAction.current = () => {
      if (following) return;
      // 官方 Provider 的布局 effect 也会恢复状态，需在它完成后再同步阅读锚点。
      const messageId = anchor?.node.dataset["messageId"];
      if (messageId !== undefined)
        scrollToMessage(messageId, { behavior: "instant", align: "start", scrollMargin: 0 });
      viewport.scrollTop = top;
      syncLayout();
    };
    return () => {
      // 在仍有布局时补齐最后一次滚动；隐藏后的零尺寸不能覆盖用户位置。
      if (viewport.clientHeight > 0) {
        capture();
        top = viewport.scrollTop;
      }
      reading.current = { following, anchor, top };
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("pointerdown", onPointerDown);
      actions.current = { pause: idle, follow: idle };
      restoreAction.current = idle;
    };
  }, [contentRef, scrollToEnd, scrollToMessage]);
  useEffect(() => {
    restoreAction.current();
  }, [contentRef, scrollToEnd, scrollToMessage]);
  return actions;
}
