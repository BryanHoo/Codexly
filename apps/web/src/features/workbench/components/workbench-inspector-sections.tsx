import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { McpServerPanel } from "@codexly/ui/core/mcp-server-panel";
import type { AgentMcpServerPage, ReloadAgentMcpServersRequest } from "@codexly/protocol";
import type { AgentBackgroundTerminal, AgentMcpServer } from "@codexly/protocol";
import { Bot, LoaderCircle, Square, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Task, TaskTrigger } from "../../../shared/components/agent/task.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import {
  formatSubagentModel,
  toSubagentTaskStatus,
  type SubagentContextEntry,
  type SubagentSelection,
} from "./subagent.js";
export function BackgroundTerminalSection({
  error,
  isPending,
  onTerminate,
  terminals,
  terminatingTerminalId,
}: Readonly<{
  error: Error | null;
  isPending: boolean;
  onTerminate: (terminalId: string) => Promise<void>;
  terminals: readonly AgentBackgroundTerminal[];
  terminatingTerminalId: string | null;
}>) {
  return (
    <InspectorSection
      icon={<SquareTerminal className="size-3.5" />}
      title={i18n.t("inspector.terminals", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.terminals", { ns: "conversation" })}>
        {isPending && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-muted-foreground">
            {i18n.t("inspector.terminalLoading", { ns: "conversation" })}
          </p>
        ) : error !== null && terminals.length === 0 ? (
          <p className="px-2 py-2 text-caption text-diff-removed">
            {i18n.t("inspector.terminalError", { ns: "conversation" })}
          </p>
        ) : (
          <div className="space-y-1">
            {terminals.map((terminal) => {
              const isTerminating = terminatingTerminalId === terminal.id;
              const terminateLabel = isTerminating
                ? i18n.t("inspector.terminalStopping", {
                    command: terminal.command,
                    ns: "conversation",
                  })
                : i18n.t("inspector.terminalStop", {
                    command: terminal.command,
                    ns: "conversation",
                  });
              return (
                <div
                  className="flex items-center gap-1 rounded-control px-2 py-1.5 hover:bg-control-hover"
                  key={terminal.id}
                >
                  <LoaderCircle
                    aria-label={i18n.t("inspector.terminalRunning", { ns: "conversation" })}
                    className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-label font-medium text-foreground"
                      title={terminal.command}
                    >
                      {terminal.command}
                    </p>
                    <p
                      className="truncate text-caption text-muted-foreground"
                      title={formatDisplayPath(terminal.cwd)}
                    >
                      {formatDisplayPath(terminal.cwd)}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={terminateLabel}
                        disabled={terminatingTerminalId !== null}
                        onClick={() => void onTerminate(terminal.id)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Square aria-hidden="true" className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{terminateLabel}</TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </InspectorSection>
  );
}

export function SubagentSection({
  onOpenSubagent,
  subagents,
}: Readonly<{
  onOpenSubagent: (selection: SubagentSelection) => void;
  subagents: readonly SubagentContextEntry[];
}>) {
  return (
    <InspectorSection
      icon={<Bot className="size-3.5" />}
      title={i18n.t("inspector.subagents", { ns: "conversation" })}
    >
      <section aria-label={i18n.t("inspector.subagents", { ns: "conversation" })}>
        <p className="mb-1 px-2 text-caption text-muted-foreground">
          {i18n.t("inspector.subagentCount", {
            count: subagents.length,
            ns: "conversation",
          })}
        </p>
        <div className="space-y-1">
          {subagents.map((subagent) => {
            const metadata = [
              subagent.model === undefined ? undefined : formatSubagentModel(subagent.model),
              subagent.reasoningEffort,
              subagent.message,
            ].filter((value): value is string => value !== undefined);
            return (
              <Button
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={i18n.t("inspector.subagentOutput", {
                  nickname: subagent.nickname,
                  ns: "conversation",
                })}
                className="w-full rounded-control px-2 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none"
                key={subagent.taskId}
                onClick={() => {
                  onOpenSubagent({
                    status: subagent.status,
                    taskId: subagent.taskId,
                    ...(subagent.embedded ? { embedded: subagent.embedded } : {}),
                  });
                }}
                type="button"
              >
                <Task collapsible={false} status={toSubagentTaskStatus(subagent.status)}>
                  <TaskTrigger title={subagent.nickname} />
                </Task>
                {metadata.length === 0 ? null : (
                  <p className="line-clamp-2 break-words pb-2 text-caption text-muted-foreground">
                    {metadata.join(" · ")}
                  </p>
                )}
              </Button>
            );
          })}
        </div>
      </section>
    </InspectorSection>
  );
}

export function McpServerSection({
  canRetry,
  isRefreshing,
  isRetrying,
  onRetry,
  servers,
  statusSource,
}: Readonly<{
  canRetry: boolean;
  isRefreshing: boolean;
  isRetrying: boolean;
  onRetry: (action?: ReloadAgentMcpServersRequest["action"]) => void;
  statusSource?: AgentMcpServerPage["statusSource"];
  observedAt?: string | null | undefined;
  servers: readonly AgentMcpServer[];
}>) {
  return (
    <McpServerPanel
      canRetry={canRetry}
      isRefreshing={isRefreshing}
      isRetrying={isRetrying}
      onRetry={onRetry}
      servers={servers}
      statusSource={statusSource}
      labels={{
        servers: i18n.t("inspector.mcpEnabled", { ns: "conversation" }),
        refresh: i18n.t("inspector.mcpRefresh", { ns: "conversation" }),
        reconnect: i18n.t("inspector.mcpReconnect", { ns: "conversation" }),
        reload: i18n.t("inspector.mcpReloadConfig", { ns: "conversation" }),
        more: i18n.t("inspector.mcpMore", { ns: "conversation" }),
        empty: i18n.t("inspector.mcpEmpty", { ns: "conversation" }),
        showMore: i18n.t("inspector.showMore", { ns: "conversation" }),
        showLess: i18n.t("inspector.mcpShowLess", { ns: "conversation" }),
      }}
      statusLabel={(status) => i18n.t(`inspector.mcpStatus.${status}`, { ns: "conversation" })}
      toolCountLabel={(count) => i18n.t("inspector.mcpToolCount", { count, ns: "conversation" })}
    />
  );
}

type InspectorSectionProps = Readonly<{
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>;

export function InspectorSection({ action, children, icon, title }: InspectorSectionProps) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2 text-xs font-medium text-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}
