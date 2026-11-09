import { useSidebarPageToggle } from "@codexly/ui/core/sidebar-page-toggle";
import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { TEMPORARY_TASK_SCOPE_ID } from "@/protocol/index.js";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarScheduledTasksLink({ projectId }: Readonly<{ projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const location = useLocation();
  const navigate = useNavigate();
  const toggle = useSidebarPageToggle({
    projectId,
    page: "scheduled",
    location,
    navigate: (href) => navigate({ href }),
  });
  const content = <CalendarClock className="size-3.5" aria-hidden="true" />;

  return (
    <SidebarIconLink label={t("scheduledTasks.title")}>
      {projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
        <Link {...toggle} params={{ projectId }} to="/p/$projectId/scheduled">
          {content}
        </Link>
      ) : (
        <Link {...toggle} to="/temporary/scheduled">{content}</Link>
      )}
    </SidebarIconLink>
  );
}
