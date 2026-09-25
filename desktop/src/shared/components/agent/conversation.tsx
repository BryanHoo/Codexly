import type { HTMLAttributes } from "react";

import {
  ConversationVirtualList,
  type ConversationVirtualListProps,
} from "./conversation-virtual-list.js";

type ConversationProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    conversationId: string;
    scrollToBottomSignal?: number;
  }>;

type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

/** 非虚拟化的短暂状态容器；历史 Turn 必须使用 ConversationList。 */
export function Conversation({
  children,
  className = "",
  conversationId: _conversationId,
  scrollToBottomSignal: _scrollToBottomSignal,
  ...props
}: ConversationProps) {
  return (
    <div
      className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}
      role="log"
      aria-live="off"
      {...props}
    >
      {children}
    </div>
  );
}

export function ConversationContent({ className = "", ...props }: ConversationContentProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-content flex-col px-4 py-6 sm:px-6 sm:py-7 ${className}`}
      {...props}
    />
  );
}

export type ConversationListProps<TItem> = ConversationVirtualListProps<TItem>;

export function ConversationList<TItem>(props: ConversationListProps<TItem>) {
  return <ConversationVirtualList {...props} />;
}
