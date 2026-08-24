import type { AgentBackgroundTerminal, AgentMcpServer } from "@codexly/protocol";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleOff,
  CircleX,
  LoaderCircle,
  Plug,
  RefreshCw,
  Square,
  SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Task, TaskTrigger } from "../../../shared/components/agent/task.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/components/core/collapsible.js";
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
                    <p className="truncate text-caption text-muted-foreground" title={terminal.cwd}>
                      {terminal.cwd}
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
                  onOpenSubagent({ status: subagent.status, taskId: subagent.taskId });
                }}
                type="button"
              >
                <Task collapsible={false} status={toSubagentTaskStatus(subagent.status)}>
                  <TaskTrigger title={subagent.nickname} />
                </Task>
                {metadata.length === 0 ? null : (
                  <p className="pb-2 text-caption text-muted-foreground">{metadata.join(" · ")}</p>
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
  error,
  isPending,
  isRefreshing,
  isRetrying,
  onRetry,
  servers,
}: Readonly<{
  canRetry: boolean;
  error: Error | null;
  isPending: boolean;
  isRefreshing: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  servers: readonly AgentMcpServer[];
}>) {
  const reloadLabel = i18n.t(isRetrying ? "inspector.mcpReloading" : "inspector.mcpReload", {
    ns: "conversation",
  });
  return (
    <InspectorSection
      action={
        canRetry ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={reloadLabel}
                disabled={isRefreshing || isRetrying}
                onClick={onRetry}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={isRefreshing || isRetrying ? "animate-spin" : undefined}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{reloadLabel}</TooltipContent>
          </Tooltip>
        ) : null
      }
      icon={<Plug className="size-3.5" />}
      title="MCP"
    >
      {isPending && servers.length === 0 ? (
        <p className="flex min-h-9 items-center gap-2 px-2 py-2 text-caption text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          {i18n.t("inspector.mcpLoading", { ns: "conversation" })}
        </p>
      ) : error !== null && servers.length === 0 ? (
        <McpRequestErrorState error={error} titleKey="inspector.mcpError" />
      ) : servers.length === 0 ? (
        <p className="px-2 py-2 text-caption text-muted-foreground">
          {i18n.t("inspector.mcpEmpty", { ns: "conversation" })}
        </p>
      ) : (
        <div
          aria-label={i18n.t("inspector.mcpEnabled", { ns: "conversation" })}
          className="space-y-0.5"
        >
          {servers.map((server) => (
            <McpServerRow key={server.name} server={server} />
          ))}
        </div>
      )}
    </InspectorSection>
  );
}

function formatMcpErrorMetadata(error: Error): string | null {
  const details: string[] = [];
  if ("code" in error && typeof error.code === "string") {
    details.push(error.code);
  }
  if ("status" in error && typeof error.status === "number") {
    details.push(`HTTP ${String(error.status)}`);
  }
  return details.length === 0 ? null : details.join(" · ");
}

function McpErrorLog({ error }: Readonly<{ error: string }>) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button className="group h-7 justify-start px-0 text-caption" type="button" variant="link">
          <ChevronRight
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-90"
            data-icon="inline-start"
          />
          {i18n.t("inspector.mcpErrorLog", { ns: "conversation" })}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:hidden" forceMount>
        <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-control bg-control px-2 py-1.5 font-mono text-meta leading-5 text-foreground">
          {error}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function McpRequestErrorState({
  error,
  titleKey,
}: Readonly<{ error: Error; titleKey: "inspector.mcpError" | "inspector.mcpRetryError" }>) {
  const metadata = formatMcpErrorMetadata(error);
  return (
    <div className="flex items-start gap-2 px-2 py-1.5" role="alert">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium text-danger">
          {i18n.t(titleKey, { ns: "conversation" })}
        </p>
        <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-meta leading-5 text-foreground">
          {error.message}
        </pre>
        {metadata === null ? null : (
          <p className="mt-1 text-meta text-muted-foreground">{metadata}</p>
        )}
      </div>
    </div>
  );
}

function McpServerRow({ server }: Readonly<{ server: AgentMcpServer }>) {
  const metadata = [
    i18n.t(`inspector.mcpStatus.${server.status}`, { ns: "conversation" }),
    ...(server.status === "ready"
      ? [i18n.t("inspector.mcpToolCount", { count: server.toolCount, ns: "conversation" })]
      : []),
    ...(server.authStatus === null
      ? []
      : [i18n.t(`inspector.mcpAuth.${server.authStatus}`, { ns: "conversation" })]),
    ...(server.version === null
      ? []
      : [i18n.t("inspector.mcpVersion", { ns: "conversation", version: server.version })]),
  ];
  const statusIcon =
    server.status === "ready" ? (
      <CheckCircle2 aria-hidden="true" className="size-3.5 text-brand" />
    ) : server.status === "starting" ? (
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" />
    ) : server.status === "failed" ? (
      <CircleX aria-hidden="true" className="size-3.5 text-danger" />
    ) : (
      <CircleOff aria-hidden="true" className="size-3.5 text-warning" />
    );

  return (
    <div className="flex min-h-10 items-start gap-2 rounded-control px-2 py-1.5">
      <span className="mt-0.5 shrink-0">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-medium text-foreground" title={server.name}>
          {server.name}
        </p>
        <p className="text-caption text-muted-foreground">{metadata.join(" · ")}</p>
        {server.failureReason === null ? null : (
          <p className="text-caption text-danger">
            {i18n.t(`inspector.mcpFailureReason.${server.failureReason}`, {
              ns: "conversation",
            })}
          </p>
        )}
        {server.error === null ? null : <McpErrorLog error={server.error} />}
      </div>
    </div>
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
