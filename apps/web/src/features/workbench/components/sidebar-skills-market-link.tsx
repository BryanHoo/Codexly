import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Link } from "@tanstack/react-router";
import { Blocks } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarSkillsMarketLink({ projectId }: Readonly<{ projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = <Blocks aria-hidden="true" className="size-3.5" />;

  return (
    <SidebarIconLink label={t("skillsMarket.title")}>
      {projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
        <Link
          activeOptions={{ includeSearch: false }}
          params={{ projectId, section: "skills" }}
          to="/p/$projectId/extensions/$section"
        >
          {content}
        </Link>
      ) : (
        <Link params={{ section: "skills" }} to="/temporary/extensions/$section">
          {content}
        </Link>
      )}
    </SidebarIconLink>
  );
}
