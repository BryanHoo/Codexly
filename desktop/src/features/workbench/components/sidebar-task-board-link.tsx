import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { TEMPORARY_TASK_SCOPE_ID } from "@/protocol/index.js";
import { Link } from "@tanstack/react-router";
import { Columns3 } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarTaskBoardLink({ projectId }: Readonly<{ projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = <Columns3 className="size-3.5" aria-hidden="true" />;

  return (
    <SidebarIconLink label={t("taskBoard.title")}>
      {projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
        <Link params={{ projectId }} to="/p/$projectId/board">
          {content}
        </Link>
      ) : (
        <Link to="/temporary/board">{content}</Link>
      )}
    </SidebarIconLink>
  );
}
