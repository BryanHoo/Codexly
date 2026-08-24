import type { Project } from "@code-agent/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { ProjectTaskListState } from "../../projects/project-context.js";
import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";

const project: Project = {
  createdAt: "2026-08-17T00:00:00.000Z",
  id: "code-agent",
  name: "CodeAgent",
  roots: [{ id: "root-code-agent", path: "/workspace/CodeAgent" }],
};

const pendingTaskState: ProjectTaskListState = {
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: true,
};

describe("ProjectSidebarTaskList", () => {
  it("renders task loading state inside the expanded Project without shifting the tree", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ProjectSidebarTaskList
          archiveTask={vi.fn()}
          deleteTask={vi.fn()}
          error={null}
          expandedProjects={new Set([project.id])}
          expandedTaskProjects={new Set()}
          fetchNextProjectTaskPage={vi.fn(() => Promise.resolve())}
          getProjectReorderProps={
            vi.fn(() => ({})) as unknown as React.ComponentProps<
              typeof ProjectSidebarTaskList
            >["getProjectReorderProps"]
          }
          hasTaskError={false}
          isPending={false}
          isProjectActionPending={false}
          isProjectAddPending={false}
          normalizedQuery=""
          onOpenProjectDraft={vi.fn(() => Promise.resolve())}
          onOpenArchived={vi.fn()}
          onOpenProjectPicker={vi.fn()}
          onOpenTemporaryDraft={vi.fn()}
          onRemoveProject={vi.fn()}
          onRenameProject={vi.fn()}
          orderedProjects={[project]}
          pinnedTasks={[]}
          pinTask={vi.fn()}
          projectOrderAnnouncement=""
          projectTaskStates={new Map([[project.id, pendingTaskState]])}
          reorderingProjectId={null}
          setExpandedTaskProjects={vi.fn()}
          setRenamingTask={vi.fn()}
          taskActionPending={false}
          taskActivity={new Map()}
          taskSearch={{ error: null, isPending: false }}
          tasksByProjectId={new Map()}
          toggleProject={vi.fn()}
        />
      </TooltipProvider>,
    );

    const projectTreePosition = markup.indexOf('data-testid="project-tree-scroll"');
    const loadingPosition = markup.indexOf("正在加载任务");

    expect(projectTreePosition).toBeGreaterThanOrEqual(0);
    expect(loadingPosition).toBeGreaterThan(projectTreePosition);
    expect(markup).not.toContain("暂无任务");
  });
});
