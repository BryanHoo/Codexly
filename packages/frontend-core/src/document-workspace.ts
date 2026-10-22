export type WorkspaceDocument = Readonly<{ id: string }>;
export type DocumentWorkspace<T extends WorkspaceDocument> = Readonly<{
  documents: readonly T[];
  activeId: string | null;
  direction: "right" | "down" | null;
}>;
export type DocumentWorkspaceAction<T extends WorkspaceDocument> =
  | { type: "open"; document: T }
  | { type: "close"; id: string }
  | { type: "select"; id: string | null }
  | { type: "compare"; direction: DocumentWorkspace<T>["direction"] };

export function createDocumentWorkspace<T extends WorkspaceDocument>(
  documents: readonly T[] = [],
): DocumentWorkspace<T> {
  return { documents, activeId: null, direction: null };
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
    case "close": {
      const index = state.documents.findIndex((document) => document.id === action.id);
      if (index === -1) return state;
      const documents = state.documents.filter((document) => document.id !== action.id);
      // 优先选右侧相邻标签，末尾则选左侧；关闭后台标签不抢走当前焦点。
      const activeId =
        state.activeId === action.id
          ? (documents[Math.min(index, documents.length - 1)]?.id ?? null)
          : state.activeId;
      return { documents, activeId, direction: documents.length === 0 ? null : state.direction };
    }
  }
}
