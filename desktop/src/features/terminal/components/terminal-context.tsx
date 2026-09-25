import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TerminalContext = createContext<{ projectId: string; rootId: string | undefined; footer: HTMLElement | null; toggle: () => void; captureFocus: () => void } | null>(null);
export function TerminalFooter({ children }: { children: ReactNode }) {
  const context = useContext(TerminalContext);
  if (context === null) return children;
  return context.footer === null ? null : createPortal(children, context.footer);
}
