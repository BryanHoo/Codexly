import { Check, ChevronRight, Circle, CircleDashed, CircleX } from "lucide-react";
import { createContext, useContext, useMemo, type HTMLAttributes, type ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";

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
  const contextValue = useMemo(() => ({ collapsible, status }), [collapsible, status]);
  const classNames = `group/task w-full text-label text-foreground ${className}`;

  return (
    <TaskContext.Provider value={contextValue}>
      {collapsible ? (
        <details
          className={classNames}
          data-ai-task=""
          data-status={status}
          open={defaultOpen}
          {...props}
        >
          {children}
        </details>
      ) : (
        <div className={classNames} data-ai-task="" data-status={status} {...props}>
          {children}
        </div>
      )}
    </TaskContext.Provider>
  );
}

const statusPresentation: Readonly<Record<TaskStatus, { icon: ReactNode; labelKey: string }>> = {
  completed: {
    icon: <Check className="size-3.5" aria-hidden="true" />,
    labelKey: "agentComponents.status.completed",
  },
  error: {
    icon: <CircleX className="size-3.5" aria-hidden="true" />,
    labelKey: "agentComponents.status.error",
  },
  in_progress: {
    icon: <CircleDashed className="size-3.5 animate-spin" aria-hidden="true" />,
    labelKey: "agentComponents.status.inProgress",
  },
  pending: {
    icon: <Circle className="size-3.5" aria-hidden="true" />,
    labelKey: "agentComponents.status.pending",
  },
};

type TaskTriggerProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  suffix?: ReactNode;
  title: string;
};

export function TaskTrigger({ className = "", suffix, title, ...props }: TaskTriggerProps) {
  const context = useContext(TaskContext);
  const { t } = useTranslation("conversation");
  if (context === null) {
    throw new Error("TaskTrigger must be used within Task");
  }
  const presentation = statusPresentation[context.status];
  const classNames = `flex min-h-9 w-full list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden ${
    context.collapsible ? "cursor-pointer" : ""
  } ${className}`;
  const content = (
    <>
      <span
        className={`shrink-0 ${context.status === "error" ? "text-danger" : "text-muted-foreground"}`}
      >
        {presentation.icon}
        <span className="sr-only">{t(presentation.labelKey)}</span>
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {suffix}
      {context.collapsible ? (
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/task:rotate-90"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return context.collapsible ? (
    <summary className={classNames} {...props}>
      {content}
    </summary>
  ) : (
    <div className={classNames} {...props}>
      {content}
    </div>
  );
}

export type TaskContentProps = HTMLAttributes<HTMLDivElement>;

export function TaskContent({ className = "", ...props }: TaskContentProps) {
  return <div className={`pb-1 pl-5 ${className}`} {...props} />;
}

export type TaskItemProps = HTMLAttributes<HTMLDivElement>;

export function TaskItem({ className = "", ...props }: TaskItemProps) {
  return (
    <div
      // 执行详情可能包含连续编码串；anywhere 同时收紧 intrinsic width，避免撑开会话栏。
      className={`min-w-0 [overflow-wrap:anywhere] border-l border-separator py-1 pl-3 text-meta leading-5 text-muted-foreground ${className}`}
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
