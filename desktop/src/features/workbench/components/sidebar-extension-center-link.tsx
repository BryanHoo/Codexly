import { useSidebarPageToggle } from "@codexly/ui/core/sidebar-page-toggle";
import { SidebarIconLink } from "@codexly/ui/core/sidebar-icon-link";
import { TEMPORARY_TASK_SCOPE_ID } from "@/protocol/index.js";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Blocks } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarExtensionCenterLink({ projectId }: Readonly<{ projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const location = useLocation();
  const navigate = useNavigate();
  const toggle = useSidebarPageToggle({
    projectId,
    page: "extensions",
    location,
    navigate: (href) => navigate({ href }),
  });
  const content = <Blocks className="size-3.5" aria-hidden="true" />;

  return (
    <SidebarIconLink label={t("skillsMarket.title")}>
      {projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
        <Link
          {...toggle}
          activeOptions={{ includeSearch: false }}

          params={{ projectId, section: "skills" }}
          to="/p/$projectId/extensions/$section"
        >
          {content}
        </Link>
      ) : (
        <Link {...toggle} params={{ section: "skills" }} to="/temporary/extensions/$section">
          {content}
        </Link>
      )}
    </SidebarIconLink>
  );
}
