export type WorkspaceDocument = Readonly<{ id: string }>;
export type DocumentWorkspace<T extends WorkspaceDocument> = Readonly<{
  documents: readonly T[];
  pinnedIds: readonly string[];
  activeId: string | null;
  direction: "right" | "down" | null;
}>;
export type DocumentWorkspaceAction<T extends WorkspaceDocument> =
  | { type: "open"; document: T }
  | { type: "close"; id: string }
  | { type: "close-many"; ids: readonly string[]; includePinned?: boolean }
  | { type: "pin"; id: string; pinned: boolean }
  | { type: "reorder"; id: string; targetId: string; placement: "before" | "after" }
  | { type: "select"; id: string | null }
  | { type: "compare"; direction: DocumentWorkspace<T>["direction"] };

export function createDocumentWorkspace<T extends WorkspaceDocument>(
  documents: readonly T[] = [],
): DocumentWorkspace<T> {
  return { documents, pinnedIds: [], activeId: null, direction: null };
}

// 只保存轻量文档描述；正文、编辑撤销栈和自动保存仍归现有文件缓存负责。
export function reduceDocumentWorkspace<T extends WorkspaceDocument>(
  state: DocumentWorkspace<T>,
  action: DocumentWorkspaceAction<T>,
): DocumentWorkspace<T> {
  switch (action.type) {
    case "open": {
      const index = state.documents.findIndex((document) => document.id === action.document.id);
      const documents = [...state.documents];
      if (index === -1) documents.push(action.document);
      else documents[index] = action.document;
      return { ...state, documents, activeId: action.document.id };
    }
    case "select":
      if (action.id !== null && !state.documents.some((document) => document.id === action.id))
        return state;
      return {
        ...state,
        activeId: action.id,
        direction: action.id === null ? null : state.direction,
      };
    case "compare":
      return state.activeId === null ? state : { ...state, direction: action.direction };
    case "pin": {
      const document = state.documents.find((item) => item.id === action.id);
      if (document === undefined || state.pinnedIds.includes(action.id) === action.pinned)
        return state;
      const pinnedIds = action.pinned
        ? [...state.pinnedIds, action.id]
        : state.pinnedIds.filter((id) => id !== action.id);
      const documents = state.documents.filter((item) => item.id !== action.id);
      // 固定区始终是前缀；取消固定后放到普通区首位，便于继续操作。
      documents.splice(action.pinned ? pinnedIds.length - 1 : pinnedIds.length, 0, document);
      return { ...state, documents, pinnedIds };
    }
    case "reorder": {
      const from = state.documents.findIndex((item) => item.id === action.id);
      const target = state.documents.findIndex((item) => item.id === action.targetId);
      if (from === -1 || target === -1 || from === target) return state;
      const documents = [...state.documents];
      const document = documents.splice(from, 1)[0];
      if (document === undefined) return state;
      const targetIndex = target - (from < target ? 1 : 0);
      const desired = targetIndex + (action.placement === "after" ? 1 : 0);
      const pinned = state.pinnedIds.includes(action.id);
      // 拖到另一分组时吸附在边界，不隐式改变用户的固定选择。
      const minimum = pinned ? 0 : state.pinnedIds.length;
      const maximum = pinned ? state.pinnedIds.length - 1 : documents.length;
      const index = Math.max(minimum, Math.min(maximum, desired));
      if (index === from) return state;
      documents.splice(index, 0, document);
      return { ...state, documents };
    }
    case "close":
    case "close-many": {
      const ids = new Set(action.type === "close" ? [action.id] : action.ids);
      if (action.type === "close-many" && !action.includePinned)
        for (const id of state.pinnedIds) ids.delete(id);
      const documents = state.documents.filter((document) => !ids.has(document.id));
      if (documents.length === state.documents.length) return state;
      const index = state.documents.findIndex((document) => document.id === state.activeId);
      // 优先选右侧相邻标签，末尾则选左侧；关闭后台标签不抢走当前焦点。
      const activeId =
        state.activeId !== null && ids.has(state.activeId)
          ? (state.documents.slice(index + 1).find((document) => !ids.has(document.id))?.id ??
            documents.at(-1)?.id ??
            null)
          : state.activeId;
      return {
        documents,
        pinnedIds: state.pinnedIds.filter((id) => !ids.has(id)),
        activeId,
        direction: activeId === null ? null : state.direction,
      };
    }
  }
}
