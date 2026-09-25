import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import type { DesktopPetTask } from "../../../protocol/desktop-pet.js";

function TaskBubble({
  activity,
  onTaskSelect,
}: Readonly<{
  activity: DesktopPetTask;
  onTaskSelect: (projectId: string, taskId: string) => void;
}>) {
  const { t } = useTranslation("workbench");
  return (
    <button
      aria-label={t("pet.openTask", {
        name: activity.taskName,
        status: t(`pet.status.${activity.status}`),
      })}
      className="workbench-pet-bubble-button"
      onClick={() => {
        onTaskSelect(activity.projectId, activity.taskId);
      }}
      title={activity.rootPath}
      type="button"
    >
      {activity.status === "waiting" ? (
        <CircleAlert aria-hidden="true" className="desktop-pet-bubble-icon text-warning" />
      ) : activity.status === "completed" ? (
        <CircleCheck aria-hidden="true" className="desktop-pet-bubble-icon text-task-completed" />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="desktop-pet-bubble-icon text-brand motion-safe:animate-spin"
        />
      )}
      <span>{activity.taskName}</span>
    </button>
  );
}

export function WorkbenchPetBubbles({
  onTaskSelect,
  tasks,
}: Readonly<{
  onTaskSelect: (projectId: string, taskId: string) => void;
  tasks: readonly DesktopPetTask[];
}>) {
  const { t } = useTranslation("workbench");
  if (tasks.length === 0) return null;
  const waitingCount = tasks.filter((activity) => activity.status === "waiting").length;
  return (
    <div className="workbench-pet-bubbles">
      <span aria-live="polite" className="sr-only">
        {t("pet.activitySummary", { count: tasks.length, waiting: waitingCount })}
      </span>
      <ol aria-label={t("pet.activeTasks")} className="workbench-pet-bubble-list">
        {/* 保持任务活动的投影顺序，状态变化不再重排可见气泡。 */}
        {tasks.map((activity) => (
          <li className="workbench-pet-bubble-item" key={`${activity.projectId}:${activity.taskId}`}>
            <TaskBubble activity={activity} onTaskSelect={onTaskSelect} />
          </li>
        ))}
      </ol>
    </div>
  );
}
