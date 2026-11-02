import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocumentChatVisibilityContext } from "@codexly/ui/core/document-navigation";

export const TerminalContext = createContext<{ projectId: string; rootId: string | undefined; footer: HTMLElement | null; toggle: () => void; captureFocus: () => void } | null>(null);
export function TerminalFooter({ children }: { children: ReactNode }) {
  const context = useContext(TerminalContext);
  const chatVisible = useContext(DocumentChatVisibilityContext);
  // Activity 只隐藏聊天的 DOM，外置底栏必须同步移除，避免文件标签残留分支和上下文栏。
  if (!chatVisible) return null;
  if (context === null) return children;
  return context.footer === null ? null : createPortal(children, context.footer);
}
