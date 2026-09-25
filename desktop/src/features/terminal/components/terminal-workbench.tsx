import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { terminalStore } from "../terminal-store.js";
import { initializeTerminalLayout, terminalActionError } from "../terminal-layout.js";
import { isTerminalShortcut } from "../terminal-shortcut.js";
import { TerminalContext } from "./terminal-context.js";

const TerminalPanel = lazy(() => import("./terminal-panel.js").then((module) => ({ default: module.TerminalPanel })));

export function TerminalWorkbench({ children, enabled, projectId, rootId, taskId, label }: { children: ReactNode; enabled: boolean; projectId: string; rootId: string | undefined; taskId?: string | undefined; label: string }) {
  const state = useSyncExternalStore(useCallback((listener) => enabled ? terminalStore.subscribe(projectId, listener) : () => undefined, [enabled, projectId]), useCallback(() => terminalStore.get(projectId), [projectId]));
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(false);
  const collapsedScope = useRef<{ projectId: string; taskId: string | undefined } | null>(null);
  const initializedScope = useRef<{ projectId: string; taskId: string | undefined } | null>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const captureFocus = useCallback(() => {
    const active = document.activeElement;
    if (!terminalStore.get(projectId).visible && active instanceof HTMLElement && active.closest("[data-project-terminal]") === null) previousFocus.current = active;
  }, [projectId]);
  const toggle = useCallback(() => {
    if (previousFocus.current === null) captureFocus();
    void import("../terminal-actions.js").then(({ toggleTerminal }) => toggleTerminal(projectId, rootId)).catch((error: unknown) => terminalActionError(projectId, error));
  }, [captureFocus, projectId, rootId]);

  useLayoutEffect(() => {
    // 设置页使用 Activity 暂停工作台；同一任务恢复时保留终端展开状态。
    if (collapsedScope.current?.projectId === projectId && collapsedScope.current.taskId === taskId) return;
    collapsedScope.current = { projectId, taskId };
    terminalStore.update(projectId, { visible: false });
  }, [projectId, taskId]);
  useEffect(() => {
    if (!enabled) return;
    if (initializedScope.current?.projectId === projectId && initializedScope.current.taskId === taskId) return;
    let active = true;
    void initializeTerminalLayout(projectId)
      .then(() => {
        // 布局恢复可能晚于任务切换完成，恢复后再次确保终端不会自动展开。
        if (active) {
          initializedScope.current = { projectId, taskId };
          terminalStore.update(projectId, { visible: false });
        }
      })
      .catch((error: unknown) => terminalActionError(projectId, error));
    return () => { active = false; };
  }, [enabled, projectId, taskId]);
  useEffect(() => {
    if (wasVisible.current && !state.visible) { if (previousFocus.current?.isConnected) previousFocus.current.focus(); previousFocus.current = null; }
    wasVisible.current = enabled && state.visible;
  }, [enabled, state.visible]);
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event, /mac/i.test(navigator.platform), true)) return;
      const modal = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some((element) => element.getClientRects().length > 0);
      if (modal) return;
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) { captureFocus(); toggle(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [captureFocus, enabled, toggle]);

  if (!enabled) return <main aria-label={label} className="flex min-h-0 min-w-0 flex-col bg-content">{children}</main>;
  return <main aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col bg-content">
    <TerminalContext.Provider value={{ projectId, rootId, footer, toggle, captureFocus }}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <div data-terminal-footer="" className="shrink-0 bg-content px-1 pb-2 sm:px-5" ref={setFooter} />
      {state.visible ? <div className="shrink-0 bg-window pb-2">
        {/* 工作台底色留白用于收住终端底边，避免内容贴住窗口边缘。 */}
        <Suspense fallback={null}><TerminalPanel projectId={projectId} rootId={rootId} /></Suspense>
      </div> : null}
    </TerminalContext.Provider>
  </main>;
}
