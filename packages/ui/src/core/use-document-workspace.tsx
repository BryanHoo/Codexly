export { DocumentEditorRegistry } from "./document-editor-registry.js";
import { DocumentEditorRegistry } from "./document-editor-registry.js";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentLeaveGuard } from "./document-navigation.js";
import {
  createDocumentWorkspace,
  reduceDocumentWorkspace,
  type DocumentWorkspaceAction,
  type WorkspaceDocument,
} from "@codexly/frontend-core/document-workspace";

export function useDocumentWorkspace<T extends WorkspaceDocument>(
  scopeKey: string,
  viewKey = scopeKey,
) {
  const [stored, setStored] = useState(() => ({
    scopeKey,
    viewKey,
    value: createDocumentWorkspace<T>(),
  }));
  const editors = useMemo(() => new DocumentEditorRegistry(), [scopeKey]);
  useLayoutEffect(
    () => () => {
      editors.dispose();
    },
    [editors],
  );
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
    [scopeKey, viewKey],
  );
  // 项目切换清空标签；同项目任务切换仅回到聊天，保留文件、固定状态和编辑句柄。
  if (stored.scopeKey !== scopeKey)
    setStored({ scopeKey, viewKey, value: createDocumentWorkspace<T>() });
  else if (stored.viewKey !== viewKey)
    setStored({
      scopeKey,
      viewKey,
      value: reduceDocumentWorkspace(stored.value, { type: "select", id: null }),
    });
  useLayoutEffect(() => {
    editors.cancelClose();
  }, [editors, viewKey]);
  const state = stored.scopeKey === scopeKey ? stored.value : createDocumentWorkspace<T>();
  useLayoutEffect(() => {
    editors.retainOnly(state.documents.map((document) => document.id));
  }, [editors, state.documents]);
  const dispatch = useCallback(
    (action: DocumentWorkspaceAction<T>) => {
      const apply = () => {
        setStored((previous) => ({
          scopeKey,
          viewKey,
          value: reduceDocumentWorkspace(
            previous.scopeKey === scopeKey ? previous.value : createDocumentWorkspace<T>(),
            action,
          ),
        }));
        return true;
      };
      const activeId = committed.current.value.activeId;
      const ids =
        action.type === "close"
          ? [action.id]
          : action.type === "close-many"
            ? action.ids.filter(
                (id) =>
                  action.includePinned === true || !committed.current.value.pinnedIds.includes(id),
              )
            : [];
      if (!ids.length) {
        // 切换标签保留草稿，无写盘、无关闭确认；新导航使旧关闭意图失效。
        if (action.type === "select" || action.type === "open") {
          generation.current++;
          editors.cancelClose();
        }
        return apply();
      }
      const request = ++generation.current;
      const registered = editors.requestClose(ids);
      const allowed =
        registered === true && activeId !== null && ids.includes(activeId)
          ? (beforeLeaveRef.current?.() ?? true)
          : registered;
      if (typeof allowed === "boolean") return allowed ? apply() : false;
      // 全部确认后才移除标签；保存失败定位到对应文件，后台冲突也能就地处理。
      return allowed
        .then((confirmed) => {
          if (request !== generation.current || committed.current.scopeKey !== scopeKey)
            return false;
          if (confirmed) return apply();
          const failedId = editors.failedId;
          if (failedId)
            setStored((previous) => ({
              scopeKey,
              viewKey,
              value: reduceDocumentWorkspace(previous.value, { type: "select", id: failedId }),
            }));
          return false;
        })
        .catch(() => false);
    },
    [scopeKey, viewKey, editors],
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
  return {
    ...state,
    open,
    close,
    closeMany,
    pin,
    reorder,
    select,
    compare,
    beforeLeaveRef,
    editors,
  };
}
