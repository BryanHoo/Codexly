import { TraceStatusIcon, type TraceStatus } from "../core/trace-status.js";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { useAgentTranslation } from "./locale.js";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "../core/trace.js";

export type TaskStatus = "completed" | "error" | "in_progress" | "pending";

type TaskContextValue = Readonly<{
  collapsible: boolean;
  status: TaskStatus;
}>;

const TaskContext = createContext<TaskContextValue | null>(null);

type TaskProps = HTMLAttributes<HTMLElement> & {
  collapsible?: boolean;
  defaultOpen?: boolean;
  status: TaskStatus;
};

export function Task({
  children,
  className = "",
  collapsible = true,
  defaultOpen = false,
  status,
  ...props
}: TaskProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contextValue = useMemo(() => ({ collapsible, status }), [collapsible, status]);
  const classNames = `group/task w-full text-body-small text-foreground ${className}`;

  return (
    <TaskContext.Provider value={contextValue}>
      <Trace>
        {collapsible ? (
          <TraceCollapsible
            className={classNames}
            data-ai-task=""
            data-status={status}
            open={open}
            onOpenChange={setOpen}
            {...props}
          >
            {children}
          </TraceCollapsible>
        ) : (
          <div className={classNames} data-ai-task="" data-status={status} {...props}>
            {children}
          </div>
        )}
      </Trace>
    </TaskContext.Provider>
  );
}

const statusPresentation: Readonly<Record<TaskStatus, { status: TraceStatus; labelKey: string }>> =
  {
    completed: { status: "completed", labelKey: "agentComponents.status.completed" },
    error: { status: "error", labelKey: "agentComponents.status.error" },
    in_progress: { status: "running", labelKey: "agentComponents.status.inProgress" },
    pending: { status: "pending", labelKey: "agentComponents.status.pending" },
  };

type TaskTriggerProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  statusPrefix?: ReactNode;
  suffix?: ReactNode;
  title: string;
};

export function TaskTrigger({
  className = "",
  statusPrefix,
  suffix,
  title,
  ...props
}: TaskTriggerProps) {
  const context = useContext(TaskContext);
  const { t } = useAgentTranslation();
  if (context === null) {
    throw new Error("TaskTrigger must be used within Task");
  }
  const presentation = statusPresentation[context.status];
  const classNames = `agent-trace-trigger flex max-w-full items-center gap-1 rounded-control text-left ${className}`;
  const content = (
    <TraceLine
      status={
        context.status === "in_progress"
          ? "running"
          : context.status === "error"
            ? "error"
            : context.status === "pending"
              ? "pending"
              : undefined
      }
    >
      {statusPrefix}
      {/* 与命令、工具共用固定尺寸的居中容器，避免行内基线使图标偏离文字中心。 */}
      <TraceIcon className={context.status === "error" ? "text-danger" : "text-muted-foreground"}>
        <TraceStatusIcon status={presentation.status} />
      </TraceIcon>
      <span className="sr-only">{t(presentation.labelKey)}</span>
      <TraceTitle>{title}</TraceTitle>
      {suffix}
    </TraceLine>
  );

  return context.collapsible ? (
    <TraceCollapsibleTrigger className={classNames} {...props}>
      {content}
    </TraceCollapsibleTrigger>
  ) : (
    <div className={classNames} {...props}>
      {content}
    </div>
  );
}

export type TaskContentProps = HTMLAttributes<HTMLDivElement>;

export function TaskContent({ className = "", ...props }: TaskContentProps) {
  const context = useContext(TaskContext);
  return context?.collapsible === false ? (
    <div className={className} {...props} />
  ) : (
    <TraceCollapsibleContent className={className} {...props} />
  );
}

export type TaskItemProps = HTMLAttributes<HTMLDivElement>;

export function TaskItem({ className = "", ...props }: TaskItemProps) {
  return (
    <div
      // 执行详情可能包含连续编码串；anywhere 同时收紧 intrinsic width，避免撑开会话栏。
      className={`min-w-0 [overflow-wrap:anywhere] py-1 text-body-small leading-5 text-muted-foreground ${className}`}
      {...props}
    />
  );
}

export type TaskItemFileProps = HTMLAttributes<HTMLSpanElement>;

export function TaskItemFile({ className = "", ...props }: TaskItemFileProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-control bg-control px-1.5 py-0.5 font-mono ${className}`}
      {...props}
    />
  );
}
