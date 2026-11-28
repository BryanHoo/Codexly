import { describe, expect, it } from "vitest";

import webSidebarSource from "../../../../../apps/web/src/features/workbench/components/project-sidebar.tsx?raw";
import projectSidebarSource from "./project-sidebar.tsx?raw";
import projectSidebarActionsSource from "./project-sidebar-actions.tsx?raw";
import projectSidebarTaskListSource from "./project-sidebar-task-list.tsx?raw";

describe("ProjectSidebar navigation", () => {
  it("orders primary actions by task workflow", () => {
    const primaryActionPositions = [
      projectSidebarSource.lastIndexOf('t("sidebar.newTask")'),
      projectSidebarSource.lastIndexOf("<SidebarTaskBoardLink"),
    ];

    expect(primaryActionPositions).not.toContain(-1);
    expect(primaryActionPositions).toEqual(
      primaryActionPositions.toSorted((left, right) => left - right),
    );
  });

  it("keeps primary navigation and the project section compact", () => {
    expect(projectSidebarSource).toContain('const primaryActionClassName =\n  "flex h-8 ');
    expect(projectSidebarTaskListSource).toContain("overflow-hidden px-2 pt-2");
  });

  it("keeps project actions visible on touch-capable desktops", () => {
    expect(projectSidebarActionsSource).toContain("project-hover-action");
    expect(projectSidebarTaskListSource).toContain("project-hover-action");
  });
});

it.each([["Web", webSidebarSource], ["桌面", projectSidebarSource]])("%s 将定时任务导航注入底栏", (_platform, source) => {
  const header = source.slice(source.indexOf("<ProjectSidebarHeader"), source.indexOf("</ProjectSidebarHeader>"));
  expect(header).not.toContain("<SidebarScheduledTasksLink");
  const footer = source.slice(source.indexOf("<SidebarSettingsButton"), source.indexOf("</SidebarSettingsButton>"));
  expect(footer).toContain("<SidebarScheduledTasksLink");
});
