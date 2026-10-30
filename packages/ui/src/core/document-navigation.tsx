import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import type { DocumentEditorBinding, DocumentEditorRegistry } from "./document-editor-registry.js";

export type DocumentLeaveGuard = () => boolean | Promise<boolean>;
export const DocumentNavigationContext = createContext<RefObject<DocumentLeaveGuard | null> | null>(
  null,
);
export const DocumentEditorContext = createContext<Readonly<{
  id: string;
  registry: DocumentEditorRegistry;
}> | null>(null);

export function useDocumentSaveGuard(editor: {
  hasUnsavedChanges: () => boolean;
  flush: () => Promise<boolean>;
  requestClose?: () => boolean | Promise<boolean>;
  documentBinding?: DocumentEditorBinding | undefined;
}) {
  const target = useContext(DocumentNavigationContext);
  const document = useContext(DocumentEditorContext);
  const latest = useRef(editor);
  useLayoutEffect(() => {
    latest.current = editor;
  });
  const binding = editor.documentBinding;
  useLayoutEffect(() => {
    // 标签切换只卸载视图，句柄交给工作区管理；真正关闭时才释放，后台文件仍能参与确认。
    if (!document || !binding) return;
    document.registry.register(document.id, binding);
    return () => {
      document.registry.detach(document.id, binding);
    };
  }, [document?.registry, document?.id, binding]);
  useLayoutEffect(() => {
    if (document || target === null) return;
    const guard = () =>
      !latest.current.hasUnsavedChanges() || (latest.current.requestClose?.() ?? false);
    target.current = guard;
    return () => {
      if (target.current === guard) target.current = null;
    };
  }, [target, document]);
  // 工作区统一负责路由保护；独立文件预览才需要注册自身的导航阻塞器。
  return document !== null;
}
