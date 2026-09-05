import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarScheduledTasksLink({
  className,
  iconClassName,
  projectId,
}: Readonly<{ className: string; iconClassName: string; projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = (
    <>
      <CalendarClock aria-hidden="true" className={iconClassName} />
      {t("scheduledTasks.title")}
    </>
  );
  const activeProps = { className: `${className} bg-control-active` };
  return projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
    <Link
      activeProps={activeProps}
      className={className}
      params={{ projectId }}
      to="/p/$projectId/scheduled"
    >
      {content}
    </Link>
  ) : (
    <Link activeProps={activeProps} className={className} to="/temporary/scheduled">
      {content}
    </Link>
  );
}
