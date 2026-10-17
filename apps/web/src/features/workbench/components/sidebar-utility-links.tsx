import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { SidebarScheduledTasksLink } from "./sidebar-scheduled-tasks-link.js";
import { SidebarSkillsMarketLink } from "./sidebar-skills-market-link.js";
import { SidebarTaskBoardLink } from "./sidebar-task-board-link.js";

interface SidebarUtilityLinksProps {
  className: string;
  iconClassName: string;
  projectId?: string;
}

export function SidebarUtilityLinks(props: SidebarUtilityLinksProps) {
  const codexEnabled = useSelectedEngines()?.includes("codex") ?? true;
  return (
    <>
      <SidebarScheduledTasksLink {...props} />
      <SidebarTaskBoardLink {...props} />
      {codexEnabled ? <SidebarSkillsMarketLink {...props} /> : null}
    </>
  );
}
