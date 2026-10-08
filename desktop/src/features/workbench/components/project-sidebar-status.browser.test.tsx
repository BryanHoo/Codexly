import type { ComponentProps } from "react";
import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStatusIndicator } from "@codexly/ui/core/project-status-indicator";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { recordNativeTaskActivity } from "../../conversation/runtime/task-activity.js";
import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";

vi.mock("../../projects/project-context.js", () => ({
  useProjectData: () => ({ client: {} }),
}));

const project = {
  createdAt: "2026-10-08T00:00:00Z",
  id: "project-a",
  name: "Codexly",
  roots: [{ id: "root", path: "/workspace/Codexly" }],
};
const taskActivity = recordNativeTaskActivity(new Map(), {
  projectId: project.id,
  taskId: "unloaded-task",
  taskName: "Task",
  status: "completed",
  requiresApproval: false,
});

function view(expanded = false) {
  const props: ComponentProps<typeof ProjectSidebarTaskList> = {
    archiveTask: vi.fn(), deleteTask: vi.fn(), error: null,
    expandedProjects: new Set(expanded ? [project.id] : []),
    expandedTaskProjects: new Set(), fetchNextProjectTaskPage: vi.fn(),
    getProjectReorderProps: vi.fn(() => ({})) as unknown as ComponentProps<
      typeof ProjectSidebarTaskList
    >["getProjectReorderProps"],
    hasTaskError: false, isPending: false, isProjectActionPending: false,
    isProjectAddPending: false, normalizedQuery: "",
    onOpenTemporaryDraft: vi.fn(), onOpenProjectDraft: vi.fn(), onOpenArchived: vi.fn(),
    onOpenProjectPicker: vi.fn(), onRemoveProject: vi.fn(), onRenameProject: vi.fn(),
    orderedProjects: [project], pinTask: vi.fn(), pinnedTasks: [],
    projectOrderAnnouncement: "", projectTaskStates: new Map(), reorderingProjectId: null,
    setExpandedTaskProjects: vi.fn(), setRenamingTask: vi.fn(), taskActionPending: false,
    taskActivity, taskSearch: { error: null, isPending: false },
    tasksByProjectId: new Map(), toggleProject: vi.fn(),
  };
  return <TooltipProvider><div style={{ width: 280 }}><ProjectSidebarTaskList {...props} /></div></TooltipProvider>;
}

describe("collapsed project status", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  it("shares the rightmost action slot and restores hover actions without layout shift", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(view());
    const status = screen.getByRole("status", { name: "AI 回复已完成", includeHidden: true });
    const create = screen.getByRole("button", { name: "在 Codexly 中新建任务", exact: true });
    await expect.element(status).toBeVisible();
    const statusRect = status.element().getBoundingClientRect();
    const actionRect = create.element().getBoundingClientRect();
    expect(Math.abs((statusRect.x + statusRect.width / 2) - (actionRect.x + actionRect.width / 2))).toBeLessThan(1);
    await userEvent.hover(create);
    await expect.element(status).not.toBeVisible();
    await expect.poll(() => getComputedStyle(create.element()).opacity).toBe("1");
    expect(create.element().getBoundingClientRect().x).toBe(actionRect.x);
    await userEvent.unhover(create);
    await expect.element(status).toBeVisible();
    await screen.rerender(view(true));
    expect(document.querySelector(".project-status")).toBeNull();
  });

  it("hides the project summary when keyboard focus needs the action slot", async () => {
    const screen = await render(view());
    const status = screen.getByRole("status", { name: "AI 回复已完成", includeHidden: true });
    screen.getByRole("button", { name: "在 Codexly 中新建任务", exact: true }).element().focus();
    await expect.element(status).not.toBeVisible();
  });

  it("keeps the desktop summary visible in a narrow desktop window", async () => {
    await page.viewport(390, 844);
    try {
      const screen = await render(view());
      await expect.element(screen.getByRole("status", { name: "AI 回复已完成", includeHidden: true })).toBeVisible();
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("hides the shared summary on a mobile width for web", async () => {
    await page.viewport(390, 844);
    try {
      await render(<ProjectStatusIndicator hideOnMobile status="completed"
        labels={{ completed: "Complete", approval: "Approval", running: "Running" }} />);
      await expect.element(document.querySelector(".project-status") as HTMLElement).not.toBeVisible();
    } finally {
      await page.viewport(1440, 900);
    }
  });
});
