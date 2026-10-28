import { useLayoutEffect, useRef, type RefObject } from "react";
import { useMessageScroller } from "../core/message-scroller.js";
import { useConversationPromptRegistry } from "./conversation-sticky-prompt.js";

/** 新提交先用尾部空间将问题靠顶，回复增长消耗空间，最低保留视口四分之一。 */
export function ConversationReadingSpace({
  viewportRef,
  signal,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  signal: number | undefined;
}) {
  const registry = useConversationPromptRegistry();
  const { scrollToEnd } = useMessageScroller();
  const submitAction = useRef<() => void>(() => undefined);
  const previousSignal = useRef(signal);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = viewport?.querySelector<HTMLElement>("[data-conversation-content]");
    if (!viewport || !content || !registry) return;
    let lastKnownUser = registry.getNodes().at(-1) ?? null;
    let previousTurnUser = lastKnownUser;
    let focusedUser: HTMLElement | null = null;
    let awaitingUser = false;
    let frame = 0;
    let previousPadding = -1;
    const sync = () => {
      const latest = registry.getNodes().at(-1) ?? null;
      if (latest !== lastKnownUser) {
        if (awaitingUser || (focusedUser !== null && !focusedUser.isConnected)) {
          // 等新用户节点出现再靠顶；pending 撤销时不能将旧问题误判为新一轮。
          focusedUser = latest === previousTurnUser ? null : latest;
          awaitingUser = false;
        }
        lastKnownUser = latest;
      }
      let padding = viewport.clientHeight / 4;
      if (focusedUser?.isConnected) {
        const last = content.lastElementChild;
        const tail = last?.hasAttribute("data-message-scroller-spacer")
          ? last.previousElementSibling
          : last;
        if (tail) {
          // 只测量新问题与末行，不逐 token 扫描历史；差值与当前 scrollTop 无关，阅读历史不受影响。
          const span =
            tail.getBoundingClientRect().bottom - focusedUser.getBoundingClientRect().top;
          padding = Math.max(padding, viewport.clientHeight - span - 12);
        }
      }
      if (Math.abs(padding - previousPadding) < 0.1) return;
      previousPadding = padding;
      viewport.style.setProperty("--conversation-reading-space", `${String(padding)}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      const latest = registry.getNodes().at(-1);
      // 临时气泡由正式消息接管时，必须在同一布局阶段恢复留白，不能等下一帧再移动输入。
      // 注销旧节点时可能短暂只剩上一轮输入，等待真实替代节点，避免把历史问题误当接管对象。
      if (focusedUser && !focusedUser.isConnected && latest && latest !== previousTurnUser) {
        sync();
        return;
      }
      frame = requestAnimationFrame(sync);
    };
    submitAction.current = () => {
      previousTurnUser = lastKnownUser;
      awaitingUser = true;
      sync();
      // 与原有跟随状态机共用官方命令；空间先就绪，避免先置底再将问题移到顶部的两段跳动。
      scrollToEnd({ behavior: "instant" });
    };
    const unsubscribe = registry.subscribe(schedule);
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(viewport);
    resize.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      resize.disconnect();
      submitAction.current = () => undefined;
    };
  }, [registry, viewportRef, scrollToEnd]);
  useLayoutEffect(() => {
    if (signal === undefined || signal === previousSignal.current) return;
    previousSignal.current = signal;
    submitAction.current();
  }, [signal]);
  return null;
}
