import { memo, useCallback, useState, useSyncExternalStore } from "react";
import {
  Bot,
  CircleHelp,
  ListTodo,
  LoaderCircle,
  Square,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Button } from "./button.js";
import { InspectorSection } from "./inspector-section.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import type { AcpSessionSource } from "@codexly/frontend-core/acp-session-binding";
import type { AcpBackgroundTarget, AcpSessionState } from "@codexly/protocol";

type Work = NonNullable<AcpSessionState["background"]>[number];

export const AcpActivity = memo(function AcpActivity({
  session,
  turnId,
  language,
}: Readonly<{
  session: AcpSessionState | undefined;
  turnId?: string | null;
  language: string;
}>) {
  const zh = language === "zh-CN";
  const foreground = session?.foreground;
  const status =
    foreground === "requires_action"
      ? zh
        ? "等待操作"
        : "Waiting for action"
      : foreground === "unknown"
        ? zh
          ? "任务状态待确认"
          : "Task status unconfirmed"
        : foreground === "running" && !turnId
          ? zh
            ? "任务正在运行"
            : "Task running"
          : undefined;
  if (!status) return null;
  return (
    <aside className="text-muted-foreground mx-auto mb-1 w-full max-w-3xl px-4 text-xs">
      <span role="status">{status}</span>
    </aside>
  );
});

type BackgroundSource = Omit<AcpSessionSource, "getState"> & {
  getState(): ReturnType<AcpSessionSource["getState"]> & { writeAccess?: string };
};

/** 右栏只订阅当前任务的后台清单，不读取历史正文或启动额外会话请求。 */
export function AcpBackgroundSection({
  source,
  projectId,
  taskId,
  language,
  onCancel,
}: Readonly<{
  source: BackgroundSource;
  projectId: string;
  taskId: string;
  language: string;
  onCancel?: (target: AcpBackgroundTarget) => Promise<unknown>;
}>) {
  const current = useCallback(() => {
    const state = source.getState();
    return state.projectId === projectId && state.taskId === taskId ? state : undefined;
  }, [source, projectId, taskId]);
  const readBackground = useCallback(
    () => current()?.snapshotMetadata?.acpSession?.background,
    [current],
  );
  const readAccess = useCallback(() => current()?.writeAccess, [current]);
  const background = useSyncExternalStore(source.subscribe, readBackground, readBackground);
  const access = useSyncExternalStore(source.subscribe, readAccess, readAccess);
  const cancel = useCallback(
    (target: AcpBackgroundTarget) => {
      const state = current();
      if (!state || (state.writeAccess !== undefined && state.writeAccess !== "writable"))
        return Promise.reject(new Error("当前任务不可写入"));
      return onCancel?.(target) ?? Promise.reject(new Error("后台停止端口不可用"));
    },
    [current, onCancel],
  );
  if (!background?.length) return null;
  const canCancel = onCancel && (access === undefined || access === "writable");
  const zh = language.startsWith("zh");
  const title = zh ? "后台任务" : "Background tasks";
  return (
    <InspectorSection title={title} icon={<ListTodo aria-hidden="true" className="size-3.5" />}>
      <ul className="space-y-1">
        {background.map((work) => (
          <AcpBackgroundItem
            key={`${work.kind}:${work.id}`}
            work={work}
            zh={zh}
            onCancel={canCancel ? cancel : undefined}
          />
        ))}
      </ul>
    </InspectorSection>
  );
}

function AcpBackgroundItem({
  work,
  zh,
  onCancel,
}: Readonly<{
  work: Work;
  zh: boolean;
  onCancel: ((target: AcpBackgroundTarget) => Promise<unknown>) | undefined;
}>) {
  const [status, setStatus] = useState<"ready" | "pending" | "requested" | "error">("ready");
  const kinds = zh
    ? { terminal: "终端", tool_call: "工具", subagent: "子 Agent", unknown: "后台任务" }
    : { terminal: "Terminal", tool_call: "Tool", subagent: "Subagent", unknown: "Background task" };
  const label = work.label ?? kinds[work.kind];
  const kind = work.kind;
  const Icon = { terminal: SquareTerminal, tool_call: Wrench, subagent: Bot, unknown: CircleHelp }[
    kind
  ];
  const waiting = status === "pending" || status === "requested";
  const stateLabel =
    status === "error"
      ? zh
        ? "停止失败，请重试"
        : "Could not stop. Try again"
      : status === "pending"
        ? zh
          ? "正在请求停止"
          : "Requesting stop"
        : status === "requested"
          ? zh
            ? "已请求停止"
            : "Stop requested"
          : work.paused
            ? zh
              ? "已暂停"
              : "Paused"
            : zh
              ? "运行中"
              : "Running";
  const stopLabel =
    status === "error"
      ? zh
        ? `重试停止 ${label}`
        : `Retry stopping ${label}`
      : zh
        ? `停止 ${label}`
        : `Stop ${label}`;
  const stop =
    onCancel && work.cancellable && (kind === "terminal" || kind === "tool_call")
      ? () => {
          setStatus("pending");
          // 接受取消只更新请求状态，实体是否结束仍由 Agent 的后续清单决定。
          void onCancel({ kind, id: work.id }).then(
            () => {
              setStatus("requested");
            },
            () => {
              setStatus("error");
            },
          );
        }
      : undefined;
  return (
    <li className="group flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-control-hover focus-within:bg-control-hover">
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-medium leading-5 text-foreground" title={label}>
          {label}
        </p>
        <p
          className={`text-caption leading-4 ${status === "error" ? "text-diff-removed" : "text-muted-foreground"}`}
          {...(status === "ready" ? {} : { role: "status" })}
        >
          {work.label ? (
            <>
              <span>{kinds[kind]}</span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          <span>{stateLabel}</span>
        </p>
      </div>
      {stop ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-compact"
              variant="ghost"
              aria-label={stopLabel}
              disabled={waiting}
              onClick={stop}
            >
              {waiting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Square aria-hidden="true" className="size-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{waiting ? stateLabel : stopLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </li>
  );
}
