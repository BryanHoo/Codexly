import { TEMPORARY_TASK_SCOPE_ID } from "@/protocol/index.js";
import { Link } from "@tanstack/react-router";
import { Blocks } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarExtensionCenterLink({
  className,
  iconClassName,
  projectId,
}: Readonly<{ className: string; iconClassName: string; projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = (
    <>
      <Blocks className={iconClassName} aria-hidden="true" />
      {t("skillsMarket.title")}
    </>
  );
  const activeProps = { className: `${className} bg-control-active` };

  return projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
    <Link
      activeOptions={{ includeSearch: false }}
      activeProps={activeProps}
      className={className}
      params={{ projectId, section: "skills" }}
      to="/p/$projectId/extensions/$section"
    >
      {content}
    </Link>
  ) : (
    <Link
      activeProps={activeProps}
      className={className}
      params={{ section: "skills" }}
      to="/temporary/extensions/$section"
    >
      {content}
    </Link>
  );
}
