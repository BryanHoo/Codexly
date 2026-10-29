import type { ComponentType } from "react";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { Subagent as SharedSubagent } from "@codexly/ui/agent/subagent";
import { withAgentLocale } from "../../../shared/components/agent/with-agent-locale.js";
import { TraceStatusIcon } from "@codexly/ui/core/trace-status";
import { resolveTurnProcessingTime, type TurnProcessingTiming } from "@codexly/frontend-core/turn-processing-time";
import { ToolDuration } from "@codexly/ui/agent/tool-duration";
import {
  TEMPORARY_TASK_SCOPE_ID,
  type AgentItem,
  type AgentItemStatus,
  type AgentTurn,
  type Project,
} from "@/protocol/index.js";
import { ChevronRight, Copy, GitFork, MessageSquareCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard.js";
import { v4 as createUuid } from "uuid";

import { i18n } from "../../../i18n/i18n.js";
import {
  getApplicationDetailViewUpdateGate,
  runDetailViewInterval,
} from "../../../shared/lifecycle/application-visibility.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";

import { MessageAction, MessageActions } from "../../../shared/components/agent/message.js";
import type { TaskStatus } from "../../../shared/components/agent/task.js";
import type { ToolState } from "../../../shared/components/agent/tool.js";
import type { ForkTaskAction } from "./task-timeline-contracts.js";
import {
  formatSubagentOperationSummary,
  getSubagentOperationTitle,
  resolveSubagentOperationStatus,
  type SubagentOperation,
} from "./subagent.js";

export { ToolDuration, formatToolDuration } from "@codexly/ui/agent/tool-duration";

export function EmptyTimeline({
  onProjectChange,
  projectId,
  projects,
  scopeName,
}: Readonly<{
  onProjectChange: (projectId: string) => void;
  projectId: string;
  projects: readonly Project[];
  scopeName?: string;
}>) {
  const temporaryName = scopeName ?? i18n.t("shell.temporaryTask", { ns: "workbench" });
  const selectedProjectName =
    projectId === TEMPORARY_TASK_SCOPE_ID
      ? temporaryName
      : (projects.find((project) => project.id === projectId)?.name ?? "");

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
          <span className="group relative mx-1 inline-block max-w-full rounded-control focus-within:bg-control-hover">
            {/* 三段标题由父级居中对齐；透明原生选择器覆盖名称，保留完整交互。 */}
            <span
              aria-hidden="true"
              className="block max-w-full truncate whitespace-pre font-sans font-normal text-foreground underline decoration-current/35 underline-offset-4 transition-colors group-hover:decoration-current"
            >
              {selectedProjectName}
            </span>
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
              <option value={TEMPORARY_TASK_SCOPE_ID}>{temporaryName}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
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

type SubagentTimelineContext = Readonly<{
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenSourceFile: (reference: MessageFileReference) => void;
  projectId: string;
  taskId: string;
}>;
const Subagent = /* @__PURE__ */ withAgentLocale(SharedSubagent);

export function SubagentToolItem({
  item,
  itemTiming,
  operation,
  renderItem: ItemContent,
  context,
}: Readonly<{
  item: Extract<AgentItem, { type: "tool" }>;
  itemTiming?: NonNullable<AgentTurn["itemTimings"]>[string] | undefined;
  operation: SubagentOperation;
  renderItem: ComponentType<
    SubagentTimelineContext & {
      item: AgentItem;
      itemTiming?: NonNullable<AgentTurn["itemTimings"]>[string] | undefined;
      isLastTurnItem: boolean;
      turnStatus: AgentTurn["status"];
    }
  >;
  context: SubagentTimelineContext;
}>) {
  const operationStatus = resolveSubagentOperationStatus(item.status, operation.agents);
  const summary = formatSubagentOperationSummary(item.status, operation.agents);

  return (
    <Subagent
      item={item}
      agents={operation.agents}
      prompt={operation.prompt}
      model={operation.model}
      reasoningEffort={operation.reasoningEffort}
      state={
        operationStatus === "in_progress"
          ? "input-available"
          : operationStatus === "error"
            ? "output-error"
            : toToolState(item.status)
      }
      duration={
        itemTiming === undefined ? undefined : (
          <ToolDuration status={item.status} timing={itemTiming} />
        )
      }
      title={`${getSubagentOperationTitle(operation.name)} · ${summary}`}
      loadOlderLabel={i18n.t("timeline.loadOlder", { ns: "conversation" })}
      // 桌面思考条目使用 text；仅投影公开 summary，不能显示原始推理 content。
      renderItem={(nested, turn, index) =>
        nested.type !== "message" &&
        nested.type !== "reasoning" &&
        nested.type !== "tool" &&
        nested.type !== "activity" &&
        nested.type !== "command" ? null : (
          <ItemContent
            {...context}
            item={
              nested.type === "reasoning"
                ? { id: nested.id, type: "reasoning", text: nested.summary }
                : nested
            }
            itemTiming={turn.itemTimings?.[nested.id]}
            isLastTurnItem={index === turn.items.length - 1}
            turnStatus={turn.status}
          />
        )
      }
    />
  );
}

const TURN_PROCESSING_TIMER_INTERVAL_MS = 1_000;

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
  status,
}: TurnProcessingTiming &
  Readonly<{ expanded?: boolean; onToggle?: () => void }>) {
  const [now, setNow] = useState(() => Date.now());
  const { isRunning, totalSeconds } = resolveTurnProcessingTime({ status, startedAt, completedAt }, now);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    // 后台持续一段时间后停止计时提交，恢复时直接按当前时间校准。
    return runDetailViewInterval(
      getApplicationDetailViewUpdateGate(),
      () => setNow(Date.now()),
      TURN_PROCESSING_TIMER_INTERVAL_MS,
    );
  }, [isRunning, startedAt]);

  if (totalSeconds === null && onToggle === undefined) return null;
  const duration = totalSeconds === null ? null : formatTurnProcessingDuration(totalSeconds);
  const content = duration === null ? i18n.t(expanded ? "timeline.collapseProcess" : "timeline.expandProcess", { ns: "conversation" }) : (
    <><span>{i18n.t("timeline.processing", { ns: "conversation" })}&nbsp;</span><time dateTime={duration.dateTime}>{duration.label}</time></>
  );
  const className =
    "agent-process-header";

  return onToggle === undefined ? (
    <div className={className} data-turn-processing-time="">
      <TraceStatusIcon status={isRunning ? "running" : "completed"} className="size-3.5 [&_svg]:size-3.5" />
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
      <TraceStatusIcon status={isRunning ? "running" : "completed"} className="size-3.5 [&_svg]:size-3.5" />
      {content}
      <ChevronRight
        aria-hidden="true"
        className={`size-3.5 text-subtle-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

export function MessageMetadata({
  lastTurnId,
  modeLabel,
  onForkTask,
  text,
}: Readonly<{
  lastTurnId?: string;
  modeLabel?: string;
  onForkTask?: ForkTaskAction;
  text: string;
}>) {
  const [forkPending, setForkPending] = useState(false);
  const forkIdempotencyKeyRef = useRef<string | null>(null);
  const messageActionLockRef = useRef(createAsyncActionLock());

  const copyMessage = () =>
    messageActionLockRef.current.run(async () => {
      try {
        // 仅在点击时复制原始 Markdown，不进行格式转换或增加渲染成本。
        await copyText(text);
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
        label={i18n.t("timeline.copyMarkdown", { ns: "conversation" })}
        tooltip={i18n.t("timeline.copyMarkdown", { ns: "conversation" })}
        onClick={() => {
          void copyMessage();
        }}
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
    </MessageActions>
  );
}
