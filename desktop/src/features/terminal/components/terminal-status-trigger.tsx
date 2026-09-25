import { useCallback, useContext, useSyncExternalStore } from "react";
import { TerminalSquare } from "lucide-react";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { terminalStore } from "../terminal-store.js";
import { TerminalContext } from "./terminal-context.js";

export function TerminalStatusTrigger() {
  const context = useContext(TerminalContext);
  const projectId = context?.projectId ?? "";
  const count = useSyncExternalStore(useCallback((listener) => terminalStore.subscribe(projectId, listener), [projectId]), useCallback(() => terminalStore.liveCount(projectId), [projectId]));
  const { t } = useTranslation("workbench");
  if (context === null) return null;
  const label = t("terminal.count", { count });
  return <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" className="h-6 gap-1 px-1 text-caption text-muted-foreground" aria-label={label} onPointerDown={context.captureFocus} onClick={context.toggle}>
    <TerminalSquare aria-hidden="true" className="size-3.5" />{count > 0 ? <span className="min-w-3 text-center tabular-nums">{count}</span> : null}
  </Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
