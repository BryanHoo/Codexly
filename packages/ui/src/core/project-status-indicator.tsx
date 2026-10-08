import type { ProjectTaskStatus } from "@codexly/frontend-core/project-task-status";
import { CircleCheck, Clock3 } from "lucide-react";

type ProjectStatusIndicatorProps = Readonly<{
  hideOnMobile?: boolean;
  status: ProjectTaskStatus | undefined;
  labels: Readonly<Record<ProjectTaskStatus, string>>;
}>;

const tones = {
  completed: "text-task-completed",
  approval: "text-task-waiting",
  running: "text-task-running",
} as const;

export function ProjectStatusIndicator({
  hideOnMobile = false,
  status,
  labels,
}: ProjectStatusIndicatorProps) {
  if (status === undefined) return null;
  return (
    <span
      aria-label={labels[status]}
      // 覆盖最右侧操作槽；悬停、聚焦及移动触屏隐藏，保持操作按钮和标题位置稳定。
      className={`project-status pointer-events-none absolute right-[7px] size-3.5 shrink-0 place-items-center group-hover/project:invisible group-focus-within/project:invisible [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden ${hideOnMobile ? "hidden min-[761px]:inline-grid" : "inline-grid"} ${tones[status]}`}
      role="status"
    >
      {status === "completed" ? (
        <CircleCheck aria-hidden="true" className="size-3.5 stroke-[2.25]" />
      ) : status === "approval" ? (
        <Clock3 aria-hidden="true" className="size-3.5 stroke-[2.25]" />
      ) : (
        <span aria-hidden="true" className="task-status-dot block size-2 rounded-full bg-current" />
      )}
    </span>
  );
}
