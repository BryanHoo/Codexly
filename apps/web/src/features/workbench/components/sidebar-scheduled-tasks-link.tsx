import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Link } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarScheduledTasksLink({ projectId }: Readonly<{ projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = <CalendarClock aria-hidden="true" className="size-3.5" />;
  return (
    <SidebarIconLink label={t("scheduledTasks.title")}>
      {projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
        <Link params={{ projectId }} to="/p/$projectId/scheduled">
          {content}
        </Link>
      ) : (
        <Link to="/temporary/scheduled">{content}</Link>
      )}
    </SidebarIconLink>
  );
}
