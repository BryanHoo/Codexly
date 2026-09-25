import { useCallback, useLayoutEffect, useRef, useState, type SetStateAction } from "react";

export const sidebarOverlayQuery = "(max-width: 760px)";
export const inspectorOverlayQuery = "(max-width: 1100px)";

export const sidebarWidthLimits = { default: 288, maximum: 400, minimum: 220 } as const;
export const inspectorWidthLimits = {
  default: 320,
  minimum: 320,
} as const;

function shouldOpenDesktopPanel(query: string) {
  return typeof window === "undefined" || !window.matchMedia(query).matches;
}

export function getInspectorMaximumWidth(shellWidth: number, sidebarWidth: number) {
  // 右栏最多占左栏之外剩余空间的一半，确保中栏始终获得同等空间。
  return Math.max(inspectorWidthLimits.minimum, Math.floor((shellWidth - sidebarWidth) / 2));
}

export function resolveInspectorVisibility(board: boolean, inspectorOpen: boolean): boolean {
  return !board && inspectorOpen;
}

export function resolveQuickOpenVisibility(board: boolean, temporary: boolean): boolean {
  return !board && !temporary;
}

export function useWorkbenchPanelLayout({ temporary = false, scopeKey = "" }: Readonly<{
  temporary?: boolean;
  scopeKey?: string;
}> = {}) {
  const [sidebarOpen, setSidebarOpen] = useState(() => shouldOpenDesktopPanel(sidebarOverlayQuery));
  const [projectInspectorOpen, setProjectInspectorOpen] = useState(() =>
    shouldOpenDesktopPanel(inspectorOverlayQuery),
  );
  const [chatInspector, setChatInspector] = useState({ scopeKey, open: false });
  // 聊天的展开操作只属于当前任务，切换任务时同步回到默认收起，不影响项目偏好。
  const inspectorOpen = temporary
    ? chatInspector.scopeKey === scopeKey && chatInspector.open
    : projectInspectorOpen;
  const setInspectorOpen = useCallback((next: SetStateAction<boolean>) => {
    if (!temporary) {
      setProjectInspectorOpen(next);
      return;
    }
    setChatInspector((previous) => ({
      scopeKey,
      open: typeof next === "function"
        ? next(previous.scopeKey === scopeKey && previous.open)
        : next,
    }));
  }, [scopeKey, temporary]);
  const [sidebarWidth, setSidebarWidth] = useState<number>(sidebarWidthLimits.default);
  const [inspectorWidth, setInspectorWidth] = useState<number>(inspectorWidthLimits.default);
  const [shellWidth, setShellWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const workbenchShellRef = useRef<HTMLDivElement>(null);
  const inspectorMaximumWidth = getInspectorMaximumWidth(
    shellWidth,
    sidebarOpen ? sidebarWidth : 0,
  );

  useLayoutEffect(() => {
    const shell = workbenchShellRef.current;
    if (shell === null) {
      return;
    }

    const syncShellWidth = () => {
      setShellWidth(shell.getBoundingClientRect().width);
    };
    syncShellWidth();
    const observer = new ResizeObserver(syncShellWidth);
    observer.observe(shell);
    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    // 窗口或左栏变化后同步收紧状态，避免分隔器语义值超过当前动态上限。
    setInspectorWidth((currentWidth) => Math.min(currentWidth, inspectorMaximumWidth));
  }, [inspectorMaximumWidth]);

  return {
    inspectorMaximumWidth,
    inspectorOpen,
    inspectorWidth,
    setInspectorOpen,
    setInspectorWidth,
    setSidebarOpen,
    setSidebarWidth,
    sidebarOpen,
    sidebarWidth,
    workbenchShellRef,
  } as const;
}
