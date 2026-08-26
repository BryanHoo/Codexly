import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { WorkbenchPetTaskActivity } from "../pet-activity.js";

function compareBubblePriority(
  left: WorkbenchPetTaskActivity,
  right: WorkbenchPetTaskActivity,
): number {
  if (left.status === right.status) return 0;
  if (left.status === "completed") return -1;
  if (right.status === "completed") return 1;
  return 0;
}

function TaskBubble({
  activity,
  localAccess,
  onTaskSelect,
}: Readonly<{
  activity: WorkbenchPetTaskActivity;
  localAccess: boolean;
  onTaskSelect: (projectId: string, taskId: string) => void;
}>) {
  const { t } = useTranslation("workbench");
  const content = (
    <button
      aria-label={t("pet.openTask", {
        name: activity.taskName,
        status: t(`pet.status.${activity.status}`),
      })}
      className="workbench-pet-bubble-button flex h-full w-full min-w-0 appearance-none items-center gap-2 rounded-control border border-separator-strong bg-raised px-2.5 text-left text-body-small text-foreground shadow-control"
      onClick={() => {
        onTaskSelect(activity.projectId, activity.taskId);
      }}
      type="button"
    >
      {activity.status === "waiting" ? (
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
      ) : activity.status === "completed" ? (
        <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-task-completed" />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 shrink-0 text-brand motion-safe:animate-spin"
        />
      )}
      <span className="min-w-0 truncate">{activity.taskName}</span>
    </button>
  );
  return localAccess ? (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{activity.rootPath}</TooltipContent>
    </Tooltip>
  ) : (
    content
  );
}

export function WorkbenchPetBubbles({
  localAccess,
  onTaskSelect,
  placement,
  tasks,
}: Readonly<{
  localAccess: boolean;
  onTaskSelect: (projectId: string, taskId: string) => void;
  placement: "above" | "below";
  tasks: readonly WorkbenchPetTaskActivity[];
}>) {
  const { t } = useTranslation("workbench");
  if (tasks.length === 0) return null;
  const waitingCount = tasks.filter((activity) => activity.status === "waiting").length;
  // 完成提醒在折叠态置于最高层，其余气泡保持原有顺序。
  const orderedTasks = tasks.toSorted(compareBubblePriority);
  return (
    <div
      className={`workbench-pet-bubbles ${placement === "above" ? "bottom-full pb-2" : "top-full pt-2"}`}
      data-placement={placement}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <span aria-live="polite" className="sr-only">
        {t("pet.activitySummary", { count: tasks.length, waiting: waitingCount })}
      </span>
      <ol
        aria-label={t("pet.activeTasks")}
        className="workbench-pet-bubble-list max-h-[40dvh] overflow-y-auto"
      >
        {orderedTasks.map((activity, index) => (
          <li
            className="workbench-pet-bubble-item"
            key={`${activity.projectId}:${activity.taskId}`}
            style={{ zIndex: orderedTasks.length - index }}
          >
            <TaskBubble activity={activity} localAccess={localAccess} onTaskSelect={onTaskSelect} />
          </li>
        ))}
      </ol>
    </div>
  );
}
