import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DocumentLeaveGuard } from "./document-navigation.js";
import {
  createDocumentWorkspace,
  reduceDocumentWorkspace,
  type DocumentWorkspaceAction,
  type WorkspaceDocument,
} from "@codexly/frontend-core/document-workspace";

export function useDocumentWorkspace<T extends WorkspaceDocument>(scopeKey: string) {
  const [stored, setStored] = useState(() => ({ scopeKey, value: createDocumentWorkspace<T>() }));
  const beforeLeaveRef = useRef<DocumentLeaveGuard | null>(null);
  const committed = useRef(stored);
  const generation = useRef(0);
  useLayoutEffect(() => {
    committed.current = stored;
  }, [stored]);
  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [scopeKey],
  );
  // 根目录变更在本次渲染内隔离；不能让旧路径在新工作树里触发一次错误读取。
  if (stored.scopeKey !== scopeKey) setStored({ scopeKey, value: createDocumentWorkspace<T>() });
  const state = stored.scopeKey === scopeKey ? stored.value : createDocumentWorkspace<T>();
  const dispatch = useCallback(
    (action: DocumentWorkspaceAction<T>) => {
      const apply = () => {
        setStored((previous) => ({
          scopeKey,
          value: reduceDocumentWorkspace(
            previous.scopeKey === scopeKey ? previous.value : createDocumentWorkspace<T>(),
            action,
          ),
        }));
        return true;
      };
      const activeId = committed.current.value.activeId;
      const leavesDocument =
        activeId !== null &&
        ((action.type === "open" && action.document.id !== activeId) ||
          (action.type === "select" && action.id !== activeId) ||
          (action.type === "close" && action.id === activeId) ||
          (action.type === "close-many" &&
            action.ids.includes(activeId) &&
            (action.includePinned === true ||
              !committed.current.value.pinnedIds.includes(activeId))));
      if (!leavesDocument) {
        // 重选当前标签无需保存，但仍代表新的导航意图，必须取消此前等待保存的关闭/切换。
        if (action.type === "select" || action.type === "open") generation.current += 1;
        return apply();
      }
      const request = ++generation.current;
      const allowed = beforeLeaveRef.current?.() ?? true;
      if (typeof allowed === "boolean") return allowed ? apply() : false;
      // 等待保存成功才离开；后续选择、切根和卸载都使旧请求失效，避免迟到回调恢复旧文件。
      return allowed
        .then((saved) => {
          if (saved && request === generation.current && committed.current.scopeKey === scopeKey)
            return apply();
          return false;
        })
        .catch(() => false);
    },
    [scopeKey],
  );
  const open = useCallback((document: T) => dispatch({ type: "open", document }), [dispatch]);
  const close = useCallback((id: string) => dispatch({ type: "close", id }), [dispatch]);
  // 批量关闭只经过一次保存保护；失败时整批保留，不能逐项关闭后才发现当前文件无法保存。
  const closeMany = useCallback(
    (ids: readonly string[], includePinned = false) =>
      dispatch({ type: "close-many", ids, includePinned }),
    [dispatch],
  );
  const pin = useCallback(
    (id: string, pinned: boolean) => dispatch({ type: "pin", id, pinned }),
    [dispatch],
  );
  const reorder = useCallback(
    (id: string, targetId: string, placement: "before" | "after") =>
      dispatch({ type: "reorder", id, targetId, placement }),
    [dispatch],
  );
  const select = useCallback((id: string | null) => dispatch({ type: "select", id }), [dispatch]);
  const compare = useCallback(
    (direction: "right" | "down" | null) => dispatch({ type: "compare", direction }),
    [dispatch],
  );
  return { ...state, open, close, closeMany, pin, reorder, select, compare, beforeLeaveRef };
}
