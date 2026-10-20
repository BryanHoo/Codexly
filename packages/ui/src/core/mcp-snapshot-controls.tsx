import type { ReloadAgentMcpServersRequest } from "@codexly/protocol";
import { MoreHorizontal, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

/** 高频刷新常显，重连与配置重载按需展开，避免窄侧栏被操作按钮挤占。 */
export function McpSnapshotControls({
  busy,
  disabled,
  showAdvanced,
  labels,
  onAction,
}: Readonly<{
  busy: boolean;
  disabled: boolean;
  showAdvanced: boolean;
  labels: Readonly<Record<"refresh" | "reconnect" | "reload" | "more", string>>;
  onAction: (action?: ReloadAgentMcpServersRequest["action"]) => void;
}>) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={labels.refresh}
            disabled={disabled}
            onClick={() => {
              // 未提供快照语义的旧引擎保留默认重载调用，避免改变原有后端行为。
              onAction(showAdvanced ? "refresh" : undefined);
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              aria-hidden="true"
              className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{labels.refresh}</TooltipContent>
      </Tooltip>
      {showAdvanced ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={labels.more}
              disabled={disabled}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => {
                onAction("reconnect");
              }}
            >
              <Unplug aria-hidden="true" className="size-3.5" />
              {labels.reconnect}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() => {
                onAction("reload");
              }}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {labels.reload}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
