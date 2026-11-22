import { AlertTriangle, CircleAlert, Info, X } from "lucide-react";
import { useState, type ComponentType } from "react";
import { Button } from "../core/button.js";
import { Task, TaskContent, TaskItem, TaskTrigger } from "./task.js";

type CompactionStatus = "in_progress" | "completed" | "failed" | "cancelled" | "unknown";

export function AcpCompactionRow({
  status,
  turnRunning,
  label,
  summary,
  error,
  Summary,
}: Readonly<{
  status: string;
  turnRunning: boolean;
  label: (status: CompactionStatus) => string;
  summary: string;
  error?: string | undefined;
  Summary: ComponentType<{ children: string; mode: "streaming" | "static" }>;
}>) {
  // 历史只有开始状态时显示通用边界，避免回合结束后仍显示运行中的动画。
  const state =
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    (status === "in_progress" && turnRunning)
      ? status
      : "unknown";
  return (
    <Task
      collapsible={Boolean(summary || error)}
      status={
        state === "failed" || state === "cancelled"
          ? "error"
          : state === "unknown"
            ? "pending"
            : state
      }
    >
      <TaskTrigger title={label(state)} />
      {summary || error ? (
        <TaskContent>
          {error ? (
            <TaskItem>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</p>
            </TaskItem>
          ) : null}
          {summary ? (
            <TaskItem>
              <Summary mode={state === "in_progress" ? "streaming" : "static"}>{summary}</Summary>
            </TaskItem>
          ) : null}
        </TaskContent>
      ) : null}
    </Task>
  );
}

export function AcpSessionNoticeRow({
  title,
  description,
  severity,
  dismissLabel,
}: Readonly<{
  title: string;
  description?: string | undefined;
  severity?: string | undefined;
  dismissLabel: string;
}>) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const Icon = severity === "error" ? CircleAlert : severity === "warning" ? AlertTriangle : Info;
  const tone =
    severity === "error"
      ? "border-danger text-danger"
      : severity === "warning"
        ? "border-warning text-warning"
        : "border-separator-strong text-muted-foreground";
  return (
    <div className={`flex items-start gap-2 border-l-2 px-3 py-2 text-label leading-5 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <div
        className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
        role={severity === "error" ? "alert" : "status"}
      >
        <p className="font-medium text-foreground">{title}</p>
        {description ? <p>{description}</p> : null}
      </div>
      <Button
        aria-label={dismissLabel}
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setDismissed(true);
        }}
        type="button"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
