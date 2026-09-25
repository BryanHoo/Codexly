import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, LoaderCircle, Plus, Square, TerminalSquare } from "lucide-react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { terminalStore } from "../terminal-store.js";
import { closeTerminal, createTerminal, loadTerminalRuntime, persistTerminalLayout } from "../terminal-actions.js";
import { terminalActionError } from "../terminal-layout.js";
import { clampTerminalHeight } from "../terminal-panel-layout.js";
import "./terminal.css";

function Tool({ label, children, disabled = false, onClick }: { label: string; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild><Button aria-label={label} title={label} disabled={disabled} type="button" variant="ghost" size="icon-sm" className="size-7 shrink-0" onClick={onClick}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

export function TerminalPanel({ projectId, rootId }: { projectId: string; rootId: string | undefined }) {
  const state = useSyncExternalStore(useCallback((listener) => terminalStore.subscribe(projectId, listener), [projectId]), useCallback(() => terminalStore.get(projectId), [projectId]));
  const { t } = useTranslation("workbench");
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [available, setAvailable] = useState(600);
  const height = clampTerminalHeight(state.height, available);
  useLayoutEffect(() => {
    const main = panel.current?.closest("main");
    if (main == null) return;
    const footer = main.querySelector<HTMLElement>("[data-terminal-footer]");
    const header = main.querySelector("header");
    const measure = () => setAvailable(main.clientHeight - (footer?.offsetHeight ?? 0) - (header?.offsetHeight ?? 0));
    const observer = new ResizeObserver(measure);
    observer.observe(main); if (footer !== null) observer.observe(footer); measure();
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{ y: number; height: number; current: number } | null>(null);
  const selected = state.terminals.find((terminal) => terminal.terminalId === state.selectedId);
  const selectedId = selected?.terminalId;
  useEffect(() => {
    const host = viewport.current;
    if (host === null || selectedId === undefined) return;
    let active = true;
    let detach: (() => void) | undefined;
    void loadTerminalRuntime().then((runtime) => { if (active) { runtime.attach(selectedId, host); detach = () => runtime.detach(selectedId); } }).catch((error: unknown) => terminalActionError(projectId, error));
    return () => { active = false; detach?.(); };
  }, [projectId, selectedId]);
  const setHeight = (value: number) => { terminalStore.update(projectId, { height: clampTerminalHeight(value, available) }); persistTerminalLayout(projectId); };
  return <section aria-label={t("terminal.title")} data-project-terminal="" className="flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-separator" style={{ height }} ref={panel}>
    <div role="separator" aria-label={t("terminal.resize")} aria-orientation="horizontal" aria-valuemin={Math.min(160, Math.max(0, available - 240))} aria-valuemax={Math.max(0, available - 240)} aria-valuenow={height} tabIndex={0} className="project-terminal-resize"
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, height, current: height }; }}
      onPointerMove={(event) => { if (drag.current === null) return; drag.current.current = clampTerminalHeight(drag.current.height + drag.current.y - event.clientY, available); if (panel.current !== null) panel.current.style.height = `${drag.current.current}px`; }}
      onPointerUp={(event) => { if (drag.current !== null) { setHeight(drag.current.current); drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { drag.current = null; if (panel.current !== null) panel.current.style.height = `${height}px`; }}
      onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setHeight(height + (event.key === "ArrowUp" ? 16 : -16)); } }} />
    <div className="flex h-8 min-w-0 shrink-0 items-center gap-1 border-b border-separator px-1">
      <div role="tablist" aria-label={t("terminal.tabs")} className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {state.terminals.map((terminal) => <button key={terminal.terminalId} type="button" role="tab" aria-selected={terminal.terminalId === selectedId} title={terminal.title} className={`flex h-7 min-w-16 max-w-48 shrink-0 items-center gap-1.5 border-b-2 px-2 text-caption ${terminal.terminalId === selectedId ? "border-brand text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => { terminalStore.update(projectId, { selectedId: terminal.terminalId }); persistTerminalLayout(projectId); }}>
          <TerminalSquare aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{terminal.title}</span>
        </button>)}
      </div>
      <Tool label={t("terminal.new")} disabled={state.creating || rootId === undefined || terminalStore.liveCount(projectId) >= 4} onClick={() => void createTerminal(projectId, rootId)}>{state.creating ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}</Tool>
      <Tool label={t("terminal.stop")} disabled={selected === undefined || selected.state === "closing"} onClick={() => { if (selected !== undefined) void closeTerminal(selected); }}><Square className="size-3" /></Tool>
      <Tool label={t("terminal.hide")} onClick={() => { terminalStore.update(projectId, { visible: false }); persistTerminalLayout(projectId); }}><ChevronDown className="size-3.5" /></Tool>
    </div>
    {state.error === null ? null : <p role="alert" className="max-h-20 shrink-0 overflow-auto break-all px-2 py-1 text-caption text-danger">{state.error}</p>}
    <div className="project-terminal-viewport" ref={viewport} role="tabpanel" aria-label={selected?.title ?? t("terminal.empty")} />
  </section>;
}
