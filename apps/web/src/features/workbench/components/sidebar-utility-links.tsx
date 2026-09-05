import { SidebarScheduledTasksLink } from "./sidebar-scheduled-tasks-link.js";
import { SidebarSkillsMarketLink } from "./sidebar-skills-market-link.js";

interface SidebarUtilityLinksProps {
  className: string;
  iconClassName: string;
  projectId?: string;
}

export function SidebarUtilityLinks(props: SidebarUtilityLinksProps) {
  return (
    <>
      <SidebarScheduledTasksLink {...props} />
      <SidebarSkillsMarketLink {...props} />
    </>
  );
}
