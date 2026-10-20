import type {
  AgentMcpServer,
  AgentMcpServerPage,
  ReloadAgentMcpServersRequest,
} from "@codexly/protocol";
import { CheckCircle2, CircleOff, CircleX, KeyRound, LoaderCircle, Plug } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/utils.js";
import { Button } from "./button.js";
import { McpSnapshotControls } from "./mcp-snapshot-controls.js";

type McpLabels = Readonly<
  Record<
    "servers" | "refresh" | "reconnect" | "reload" | "more" | "empty" | "showMore" | "showLess",
    string
  >
>;

/** 两种引擎、Web 与桌面共用展示，只由宿主注入翻译及操作，防止视觉与状态语义漂移。 */
export function McpServerPanel({
  canRetry,
  isRefreshing,
  isRetrying,
  onRetry,
  servers,
  statusSource,
  labels,
  statusLabel,
  toolCountLabel,
}: Readonly<{
  canRetry: boolean;
  isRefreshing: boolean;
  isRetrying: boolean;
  onRetry: (action?: ReloadAgentMcpServersRequest["action"]) => void;
  servers: readonly AgentMcpServer[];
  statusSource?: AgentMcpServerPage["statusSource"];
  labels: McpLabels;
  statusLabel: (status: AgentMcpServer["status"]) => string;
  toolCountLabel: (count: number) => string;
}>) {
  const [expanded, setExpanded] = useState(false);
  if (servers.length === 0 && !statusSource) return null;

  const busy = isRefreshing || isRetrying;
  // 首屏最多挂载五行；完整列表只在用户请求后渲染，不增加请求、轮询或全量工具详情。
  const visibleServers = expanded ? servers : servers.slice(0, 5);

  return (
    <section aria-label="MCP" aria-busy={busy}>
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
          <Plug aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span>MCP</span>
          <span className="rounded-control bg-control px-1.5 text-caption tabular-nums text-muted-foreground">
            {servers.length}
          </span>
        </div>
        {canRetry ? (
          <McpSnapshotControls
            busy={busy}
            disabled={busy}
            showAdvanced={Boolean(statusSource)}
            labels={labels}
            onAction={onRetry}
          />
        ) : null}
      </div>
      <div aria-label={labels.servers} className="space-y-0.5">
        {servers.length === 0 ? (
          <p className="px-2 py-3 text-caption text-muted-foreground">{labels.empty}</p>
        ) : (
          visibleServers.map((server) => (
            <McpServerRow
              key={server.name}
              server={server}
              statusLabel={statusLabel(server.status)}
              toolCountLabel={toolCountLabel(server.toolCount)}
            />
          ))
        )}
        {servers.length > 5 ? (
          <Button
            aria-expanded={expanded}
            className="w-full"
            onClick={() => {
              setExpanded((value) => !value);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {expanded ? labels.showLess : labels.showMore}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function McpServerRow({
  server,
  statusLabel,
  toolCountLabel,
}: Readonly<{
  server: AgentMcpServer;
  statusLabel: string;
  toolCountLabel: string;
}>) {
  const tone =
    server.status === "connected"
      ? "text-brand"
      : server.status === "failed"
        ? "text-danger"
        : server.status === "authenticationRequired"
          ? "text-warning"
          : "text-muted-foreground";
  const Icon =
    server.status === "connected"
      ? CheckCircle2
      : server.status === "starting"
        ? LoaderCircle
        : server.status === "failed"
          ? CircleX
          : server.status === "authenticationRequired"
            ? KeyRound
            : CircleOff;

  return (
    <div
      aria-label={server.name}
      className="flex min-h-11 items-start gap-2.5 rounded-control px-2 py-2 transition-colors hover:bg-control-hover"
      data-mcp-server-row=""
      data-mcp-status={server.status}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          tone,
          server.status === "starting" && "animate-spin motion-reduce:animate-none",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p
            className="min-w-0 flex-1 truncate text-label font-medium text-foreground"
            title={server.displayName}
          >
            {server.displayName}
          </p>
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {toolCountLabel}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption">
          <span className={cn("shrink-0", tone)}>{statusLabel}</span>
          {server.httpOrigin ? (
            <>
              <span aria-hidden="true" className="text-subtle-foreground">
                ·
              </span>
              <span className="truncate text-muted-foreground" title={server.httpOrigin}>
                {server.httpOrigin}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
