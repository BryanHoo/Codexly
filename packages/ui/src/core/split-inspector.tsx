import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { SplitPaneContext, useSplitWorkspace } from "./split-workspace.js";
import { splitPaneKey } from "@codexly/frontend-core/split-workspace";

type SidebarDocument = Readonly<{
  id: string;
  kind: "source" | "image" | "pdf";
  projectId: string;
  rootPath: string;
  reference: { lineNumber: null; path: string };
}>;
type OpenDocument = (document: SidebarDocument) => void;
type Inspector = Readonly<{
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  target: HTMLElement | null;
  setTarget: Dispatch<SetStateAction<HTMLElement | null>>;
  openDocumentRef: RefObject<OpenDocument | null>;
}>;
const SplitInspectorContext = createContext<Inspector | null>(null);
export const useSplitInspector = () => useContext(SplitInspectorContext);

export function SplitInspectorProvider({
  children,
  open,
  setOpen,
}: Readonly<{
  children: ReactNode;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}>) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const openDocumentRef = useRef<OpenDocument | null>(null);
  const value = useMemo(
    () => ({ open, setOpen, target, setTarget, openDocumentRef }),
    [open, setOpen, target],
  );
  return <SplitInspectorContext value={value}>{children}</SplitInspectorContext>;
}

export function useSplitInspectorBridge(
  shellRef: RefObject<HTMLDivElement | null>,
  openDocument: OpenDocument,
) {
  const inspector = useSplitInspector();
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspace();
  const activePane = workspace?.panes.find((item) => splitPaneKey(item) === workspace.activeKey);
  const setTarget = inspector?.setTarget;
  const openDocumentRef = inspector?.openDocumentRef;
  const root = pane === null;
  const active = pane?.active ?? false;
  useLayoutEffect(() => {
    if (!root || setTarget === undefined) return;
    // Portal 直接挂到外层网格，右栏与左栏平级；聊天仍保留原有 React 归属和回调。
    setTarget(shellRef.current);
    return () => {
      setTarget(null);
    };
  }, [root, setTarget, shellRef]);
  useLayoutEffect(() => {
    if (!active || openDocumentRef === undefined) return;
    // 左栏搜索打开文件时交给活动聊天，文件引用会返回该聊天自己的输入框。
    openDocumentRef.current = openDocument;
    return () => {
      if (openDocumentRef.current === openDocument) openDocumentRef.current = null;
    };
  }, [active, openDocument, openDocumentRef]);
  const openSidebarDocument = useCallback(
    (document: SidebarDocument) => {
      if (root && activePane !== undefined && openDocumentRef !== undefined) {
        openDocumentRef.current?.(document);
      } else openDocument(document);
    },
    [root, activePane, openDocumentRef, openDocument],
  );
  return { activePane, openSidebarDocument };
}
