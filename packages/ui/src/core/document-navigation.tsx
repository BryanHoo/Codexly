import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";

export type DocumentLeaveGuard = () => boolean | Promise<boolean>;
export const DocumentNavigationContext = createContext<RefObject<DocumentLeaveGuard | null> | null>(
  null,
);

export function useDocumentSaveGuard(editor: {
  hasUnsavedChanges: () => boolean;
  flush: () => Promise<boolean>;
}) {
  const target = useContext(DocumentNavigationContext);
  const latest = useRef(editor);
  useLayoutEffect(() => {
    latest.current = editor;
  });
  useLayoutEffect(() => {
    if (target === null) return;
    const guard = () => (latest.current.hasUnsavedChanges() ? latest.current.flush() : true);
    target.current = guard;
    return () => {
      if (target.current === guard) target.current = null;
    };
  }, [target]);
}
