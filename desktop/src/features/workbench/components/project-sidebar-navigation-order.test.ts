import { describe, expect, it } from "vitest";

import projectSidebarSource from "./project-sidebar.tsx?raw";
import projectSidebarTaskListSource from "./project-sidebar-task-list.tsx?raw";

describe("ProjectSidebar navigation", () => {
  it("orders primary actions by task workflow", () => {
    const primaryActionPositions = [
      projectSidebarSource.lastIndexOf('t("sidebar.newTask")'),
      projectSidebarSource.lastIndexOf("<SidebarScheduledTasksLink"),
      projectSidebarSource.lastIndexOf("<SidebarTaskBoardLink"),
      projectSidebarSource.lastIndexOf("<SidebarExtensionCenterLink"),
    ];

    expect(primaryActionPositions).not.toContain(-1);
    expect(primaryActionPositions).toEqual(primaryActionPositions.toSorted((left, right) => left - right));
  });

  it("keeps primary navigation and the project section compact", () => {
    expect(projectSidebarSource).toContain('const primaryActionClassName =\n  "flex h-8 ');
    expect(projectSidebarTaskListSource).toContain("overflow-hidden px-2 pt-2");
  });
});
