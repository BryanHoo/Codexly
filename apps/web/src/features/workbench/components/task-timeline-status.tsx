import type { AgentItem, AgentItemStatus, AgentTurn, Project } from "@code-agent/protocol";
import { ChevronRight, Copy, GitFork, MessageSquareCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { v4 as createUuid } from "uuid";

import { getCurrentLanguage, i18n } from "../../../i18n/i18n.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";

import { MessageAction, MessageActions } from "../../../shared/components/agent/message.js";
import { Task, TaskTrigger, type TaskStatus } from "../../../shared/components/agent/task.js";
import type { ToolState } from "../../../shared/components/agent/tool.js";
import type { ForkTaskAction } from "./task-timeline-contracts.js";
import {
  formatSubagentOperationSummary,
  getSubagentOperationTitle,
  resolveSubagentOperationStatus,
  type SubagentOperation,
} from "./subagent.js";

export function EmptyTimeline({
  onProjectChange,
  projectId,
  projects,
  scopeName,
}: Readonly<
  | {
      onProjectChange: (projectId: string) => void;
      projectId: string;
      projects: readonly Project[];
      scopeName?: undefined;
    }
  | {
      onProjectChange?: undefined;
      projectId?: undefined;
      projects?: undefined;
      scopeName: string;
    }
>) {
  const selectedProjectName =
    scopeName ?? projects.find((project) => project.id === projectId)?.name ?? "";

  return (
    <section
      className="grid min-h-0 flex-1 place-items-center px-6"
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
    >
      <div className="w-full max-w-xl text-center">
        <MessageSquareCode
          aria-hidden="true"
          className="mx-auto size-12 text-muted-foreground/55"
          strokeWidth={1.35}
        />
        <h2 className="mt-5 flex flex-wrap items-center justify-center text-balance text-xl font-normal leading-tight text-foreground">
          {i18n.t("timeline.emptyBefore", { ns: "conversation" })}
          <span className="group relative mx-1 inline-block max-w-full rounded-control focus-within:shadow-focus">
            {/* 三段标题由父级居中对齐；透明原生选择器覆盖名称，保留完整交互。 */}
            <span
              aria-hidden="true"
              className="block max-w-full truncate whitespace-pre font-sans font-normal text-foreground underline decoration-current/35 underline-offset-4 transition-colors group-hover:decoration-current"
            >
              {selectedProjectName}
            </span>
            {scopeName === undefined ? (
              <select
                aria-label={i18n.t("timeline.selectProject", { ns: "conversation" })}
                className="absolute inset-0 size-full min-w-0 cursor-pointer appearance-none opacity-0 outline-none"
                onChange={(event) => {
                  const nextProjectId = event.currentTarget.value;
                  if (nextProjectId !== projectId) {
                    onProjectChange(nextProjectId);
                  }
                }}
                value={projectId}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : null}
          </span>
          {i18n.t("timeline.emptyAfter", { ns: "conversation" })}
        </h2>
      </div>
    </section>
  );
}

export function TimelineState({
  message,
  role,
}: Readonly<{ message: string; role?: "alert" | "status" }>) {
  return (
    <section
      aria-label={i18n.t("timeline.conversation", { ns: "conversation" })}
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </section>
  );
}

export function toToolState(status: AgentItemStatus): ToolState {
  // Protocol 状态在视图边界映射到官方 Tool 的完整执行状态，不引入 AI SDK Runtime 类型。
  if (status === "pending") {
    return "input-streaming";
  }
  if (status === "running") {
    return "input-available";
  }
  if (status === "declined") {
    return "output-denied";
  }
  if (status === "failed" || status === "interrupted") {
    return "output-error";
  }
  return "output-available";
}

export function toTaskStatus(status: AgentItemStatus): TaskStatus {
  // Activity 使用 项目 Agent 组件 的四态模型，协议中的拒绝与中断都属于失败终态。
  if (status === "pending") {
    return "pending";
  }
  if (status === "running") {
    return "in_progress";
  }
  if (status === "failed" || status === "declined" || status === "interrupted") {
    return "error";
  }
  return "completed";
}

export function formatStructuredValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function SubagentToolItem({
  item,
  operation,
}: Readonly<{
  item: Extract<AgentItem, { type: "tool" }>;
  operation: SubagentOperation;
}>) {
  const operationStatus = resolveSubagentOperationStatus(item.status, operation.agents);
  const summary = formatSubagentOperationSummary(item.status, operation.agents);

  return (
    <Task collapsible={false} status={operationStatus}>
      <TaskTrigger title={`${getSubagentOperationTitle(operation.name)} · ${summary}`} />
    </Task>
  );
}

const TURN_PROCESSING_TIMER_INTERVAL_MS = 1_000;

type MessageDateFormatters = Readonly<{
  full: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
}>;

const messageDateFormattersByLocale = new Map<string, MessageDateFormatters>();

function getMessageDateFormatters(locale: string): MessageDateFormatters {
  const cachedFormatters = messageDateFormattersByLocale.get(locale);
  if (cachedFormatters !== undefined) {
    return cachedFormatters;
  }

  // 流式更新会频繁重渲染消息，按语言复用构造成本较高的日期格式器。
  const formatters = {
    full: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
    }),
  };
  messageDateFormattersByLocale.set(locale, formatters);
  return formatters;
}

export function formatTurnProcessingDuration(totalSeconds: number): Readonly<{
  dateTime: string;
  label: string;
}> {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    dateTime: `PT${hours > 0 ? `${String(hours)}H` : ""}${minutes > 0 ? `${String(minutes)}M` : ""}${String(seconds)}S`,
    label:
      hours > 0
        ? `${String(hours)}h ${String(minutes)}m ${String(seconds)}s`
        : minutes > 0
          ? `${String(minutes)}m ${String(seconds)}s`
          : `${String(seconds)}s`,
  };
}

export function TurnProcessingTime({
  completedAt,
  expanded,
  onToggle,
  startedAt,
}: Pick<AgentTurn, "completedAt" | "startedAt"> &
  Readonly<{ expanded?: boolean; onToggle?: () => void }>) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null || completedAt !== null) {
      return;
    }

    // 只更新独立计时行，Turn 完成后立即清理并改用服务端终态时间。
    const intervalId = globalThis.setInterval(() => {
      setNow(Date.now());
    }, TURN_PROCESSING_TIMER_INTERVAL_MS);
    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [completedAt, startedAt]);

  if (startedAt === null) {
    return null;
  }
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = completedAt === null ? now : Date.parse(completedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1_000));
  const duration = formatTurnProcessingDuration(totalSeconds);

  const content = (
    <>
      <span>{i18n.t("timeline.processing", { ns: "conversation" })}&nbsp;</span>
      <time dateTime={duration.dateTime}>{duration.label}</time>
    </>
  );
  const className =
    "mb-4 flex w-full items-center border-b border-separator pb-2.5 text-label font-medium text-muted-foreground";

  return onToggle === undefined ? (
    <div className={className} data-turn-processing-time="">
      {content}
    </div>
  ) : (
    <button
      aria-expanded={expanded ?? false}
      aria-label={i18n.t(expanded ? "timeline.collapseProcess" : "timeline.expandProcess", {
        ns: "conversation",
      })}
      className={`${className} cursor-pointer text-left transition-colors hover:text-foreground focus-visible:shadow-focus`}
      data-turn-processing-time=""
      onClick={onToggle}
      type="button"
    >
      {content}
      <ChevronRight
        aria-hidden="true"
        className={`ms-auto size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

export function getMessageTimestamp(
  role: "assistant" | "user",
  turn: Pick<AgentTurn, "completedAt" | "startedAt">,
  latestSnapshotTimestamp: string,
): string {
  // 协议尚未记录 Item 时间；用户消息使用 Turn 开始时间，AI 消息使用完成或最新事件时间。
  if (role === "user") {
    return turn.startedAt ?? latestSnapshotTimestamp;
  }
  return turn.completedAt ?? latestSnapshotTimestamp;
}

export function MessageMetadata({
  lastTurnId,
  modeLabel,
  onForkTask,
  text,
  timestamp,
}: Readonly<{
  lastTurnId?: string;
  modeLabel?: string;
  onForkTask?: ForkTaskAction;
  text: string;
  timestamp?: string;
}>) {
  const [forkPending, setForkPending] = useState(false);
  const forkIdempotencyKeyRef = useRef<string | null>(null);
  const messageActionLockRef = useRef(createAsyncActionLock());
  const messageDate = timestamp === undefined ? undefined : new Date(timestamp);
  const locale = getCurrentLanguage();
  const dateFormatters = messageDate === undefined ? undefined : getMessageDateFormatters(locale);

  const copyMessage = () =>
    messageActionLockRef.current.run(async () => {
      try {
        // 只在明确点击时访问 Clipboard，避免渲染阶段触发浏览器权限请求。
        await navigator.clipboard.writeText(text);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
      }
    });

  const forkTask = () =>
    messageActionLockRef.current.run(async () => {
      if (lastTurnId === undefined || onForkTask === undefined) {
        return;
      }
      forkIdempotencyKeyRef.current ??= createUuid();
      setForkPending(true);
      try {
        // 重试复用同一幂等键，避免响应丢失时重复创建任务。
        await onForkTask(lastTurnId, forkIdempotencyKeyRef.current);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
      } finally {
        setForkPending(false);
      }
    });

  return (
    <MessageActions className="mt-2 text-label text-muted-foreground">
      <MessageAction
        label={i18n.t("timeline.copyMessage", { ns: "conversation" })}
        onClick={() => {
          void copyMessage();
        }}
        tooltip={i18n.t("timeline.copyMessage", { ns: "conversation" })}
      >
        <Copy className="size-3.5" aria-hidden="true" />
      </MessageAction>
      {lastTurnId === undefined || onForkTask === undefined ? null : (
        <MessageAction
          disabled={forkPending}
          label={
            forkPending
              ? i18n.t("timeline.forking", { ns: "conversation" })
              : i18n.t("timeline.fork", { ns: "conversation" })
          }
          onClick={() => {
            void forkTask();
          }}
          tooltip={i18n.t("timeline.fork", { ns: "conversation" })}
        >
          <GitFork className="size-3.5" aria-hidden="true" />
        </MessageAction>
      )}
      {modeLabel === undefined ? null : <span>{modeLabel}</span>}
      {timestamp === undefined || messageDate === undefined ? null : (
        <time dateTime={timestamp} title={dateFormatters?.full.format(messageDate)}>
          {dateFormatters?.time.format(messageDate)}
        </time>
      )}
    </MessageActions>
  );
}
