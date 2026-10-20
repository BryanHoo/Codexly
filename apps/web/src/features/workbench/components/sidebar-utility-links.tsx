import { SidebarScheduledTasksLink } from "./sidebar-scheduled-tasks-link.js";
import { SidebarSkillsMarketLink } from "./sidebar-skills-market-link.js";
import { SidebarTaskBoardLink } from "./sidebar-task-board-link.js";

interface SidebarUtilityLinksProps {
  className: string;
  iconClassName: string;
  projectId?: string;
}

export function SidebarUtilityLinks(props: SidebarUtilityLinksProps) {
  return (
    <>
      <SidebarScheduledTasksLink {...props} />
      <SidebarTaskBoardLink {...props} />
      <SidebarSkillsMarketLink {...props} />
    </>
  );
}
