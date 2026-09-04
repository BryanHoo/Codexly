import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { Link } from "@tanstack/react-router";
import { Blocks } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";

export function SidebarSkillsMarketLink({
  className,
  iconClassName,
  projectId,
}: Readonly<{ className: string; iconClassName: string; projectId?: string }>) {
  const { t } = useTranslation("workbench");
  const content = (
    <>
      <Blocks aria-hidden="true" className={iconClassName} />
      {t("skillsMarket.title")}
    </>
  );
  const activeProps = { className: `${className} bg-control-active` };

  return projectId !== undefined && projectId !== TEMPORARY_TASK_SCOPE_ID ? (
    <Link
      activeProps={activeProps}
      className={className}
      params={{ projectId }}
      to="/p/$projectId/skills"
    >
      {content}
    </Link>
  ) : (
    <Link activeProps={activeProps} className={className} to="/temporary/skills">
      {content}
    </Link>
  );
}
