const BOTTOM_PROXIMITY_THRESHOLD_PX = 24;

export type ConversationScrollTarget = Pick<
  HTMLDivElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type AtBottomChangeHandler = (atBottom: boolean) => void;

export function createConversationAutoScrollController(onAtBottomChange: AtBottomChangeHandler) {
  let conversationRendering = false;
  let lastObservedClientHeight: number | undefined;
  let lastObservedScrollHeight: number | undefined;
  let shouldFollowNewContent = true;

  const updateFollowState = (atBottom: boolean) => {
    shouldFollowNewContent = atBottom;
    onAtBottomChange(atBottom);
  };

  const scrollToBottom = (scrollTarget: ConversationScrollTarget, behavior: ScrollBehavior) => {
    lastObservedClientHeight = scrollTarget.clientHeight;
    lastObservedScrollHeight = scrollTarget.scrollHeight;
    scrollTarget.scrollTo({ behavior, top: scrollTarget.scrollHeight });
    updateFollowState(true);
  };

  return {
    handleConversationChange(scrollTarget: ConversationScrollTarget) {
      // Task 消息完成分帧渲染前保持强制跟随，避免临时 scroll 事件关闭自动置底。
      conversationRendering = true;
      scrollToBottom(scrollTarget, "auto");
    },
    handleConversationRenderComplete(scrollTarget: ConversationScrollTarget) {
      // 使用最终布局高度完成最后一次置底，随后恢复正常的用户滚动判断。
      scrollToBottom(scrollTarget, "auto");
      conversationRendering = false;
    },
    handleContentResize(scrollTarget: ConversationScrollTarget) {
      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;
      if (!shouldFollowNewContent) {
        return;
      }

      // 流式内容增长时直接跟随，避免连续 smooth 动画相互堆叠。
      scrollToBottom(scrollTarget, "auto");
    },
    handleScroll(scrollTarget: ConversationScrollTarget) {
      if (conversationRendering) {
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const viewportHeightChanged =
        lastObservedClientHeight !== undefined &&
        scrollTarget.clientHeight !== lastObservedClientHeight;
      const contentHeightIncreased =
        lastObservedScrollHeight !== undefined &&
        scrollTarget.scrollHeight > lastObservedScrollHeight;
      lastObservedClientHeight = scrollTarget.clientHeight;
      lastObservedScrollHeight = scrollTarget.scrollHeight;

      if (shouldFollowNewContent && (contentHeightIncreased || viewportHeightChanged)) {
        // 内容增长或中栏高度变化可能先触发 scroll；布局变化不应被当成用户离开底部。
        scrollToBottom(scrollTarget, "auto");
        return;
      }

      const distanceFromBottom =
        scrollTarget.scrollHeight - scrollTarget.scrollTop - scrollTarget.clientHeight;
      updateFollowState(distanceFromBottom < BOTTOM_PROXIMITY_THRESHOLD_PX);
    },
    scrollToBottom(scrollTarget: ConversationScrollTarget) {
      scrollToBottom(scrollTarget, "smooth");
    },
  };
}
