import { readFileSync } from "node:fs";
import type * as RouterModule from "@tanstack/react-router";
import type { Project } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { ProjectTaskListState } from "../../projects/project-context.js";
import type { TaskActivityMap } from "../../conversation/runtime/task-activity.js";
import { ProjectSidebarTaskList } from "./project-sidebar-task-list.js";

// 此处验证侧栏分组与状态聚合，路由和分屏选择由导航测试及 CDP 交互验证覆盖。
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof RouterModule>();
  return {
    ...original,
    createLink:
      () =>
      ({
        taskActive,
        to,
        params,
        children,
        ...props
      }: {
        taskActive: boolean;
        to: string;
        params: Record<string, string>;
        children: React.ReactNode;
      }) => (
        <a
          {...props}
          href={to.replace(/\$([\w]+)/gu, (_, key: string) => params[key] ?? "")}
          aria-current={taskActive ? "page" : undefined}
        >
          {children}
        </a>
      ),
  };
});

const project: Project = {
  createdAt: "2026-08-17T00:00:00.000Z",
  id: "codexly",
  name: "Codexly",
  roots: [{ id: "root-codexly", path: "/workspace/Codexly" }],
};

const pendingTaskState: ProjectTaskListState = {
  error: null,
  hasNextPage: false,
  isFetchingNextPage: false,
  isPending: true,
};

function renderProjectTaskList(
  expandedProjects: ReadonlySet<string> = new Set([project.id]),
  taskActivity: TaskActivityMap = new Map(),
  includeShortcuts = false,
) {
  const markup = renderToStaticMarkup(
    <TooltipProvider>
      <ProjectSidebarTaskList
        archiveTask={vi.fn()}
        client={{} as React.ComponentProps<typeof ProjectSidebarTaskList>["client"]}
        deleteTask={vi.fn()}
        error={null}
        expandedProjects={expandedProjects}
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
        onWorktreeTaskCreated={vi.fn()}
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
        taskActivity={taskActivity}
        taskSearch={{ error: null, isPending: false }}
        tasksByProjectId={new Map()}
        toggleProject={vi.fn()}
      />
    </TooltipProvider>,
  );
  return includeShortcuts
    ? markup
    : markup.slice(markup.indexOf('aria-labelledby="projects-title"'));
}

describe("ProjectSidebarTaskList", () => {
  function activityFor(
    states: readonly ("running" | "approval" | "completed" | "failed" | null)[],
  ): TaskActivityMap {
    return new Map(
      states.map((state, index) => [
        String(index),
        {
          projectId: project.id,
          taskId: String(index),
          attention: state === "running" ? null : state,
          isRunning: state === "running" || state === "approval",
          pendingApprovalRequestIds: new Set(state === "approval" ? ["request"] : []),
        },
      ]),
    );
  }

  it("shows unloaded active tasks above the project tree and excludes completed tasks", () => {
    const markup = renderProjectTaskList(
      new Set(),
      activityFor(["running", "approval", "completed"]),
      true,
    );
    expect(markup).toContain("运行中");
    expect(markup).toContain("待确认 1");
    expect(markup).toContain('href="/p/codexly/t/0"');
    expect(markup).toContain('href="/p/codexly/t/1"');
    expect(markup).not.toContain('href="/p/codexly/t/2"');
    expect(markup.indexOf('data-sidebar-shortcut-group="active"')).toBeLessThan(
      markup.indexOf('data-testid="project-tree-scroll"'),
    );
  });

  it("shows unread completion ahead of approval and running even without loaded tasks", () => {
    for (const states of [
      ["running", "approval", "completed"],
      ["completed", "approval", "running"],
    ] as const) {
      const markup = renderProjectTaskList(new Set(), activityFor(states));
      expect(markup).toContain('aria-label="AI 回复已完成"');
      expect(markup).toContain("project-status");
      expect(markup).not.toContain('aria-label="任务等待审批"');
      expect(markup).not.toContain('aria-label="任务运行中"');
    }
  });

  it("falls back to approval and running after completion attention is cleared", () => {
    expect(renderProjectTaskList(new Set(), activityFor([null, "approval", "running"]))).toContain(
      'aria-label="任务等待审批"',
    );
    expect(renderProjectTaskList(new Set(), activityFor([null, "running"]))).toContain(
      'aria-label="任务运行中"',
    );
  });

  it("keeps approval visible after it is viewed while the request remains pending", () => {
    const taskActivity: TaskActivityMap = new Map([
      [
        "task",
        {
          projectId: project.id,
          taskId: "task",
          attention: null,
          isRunning: true,
          pendingApprovalRequestIds: new Set(["request"]),
        },
      ],
    ]);
    expect(renderProjectTaskList(new Set(), taskActivity)).toContain('aria-label="任务等待审批"');
  });

  it("does not show a project status for expanded, viewed, failed, or unrelated tasks", () => {
    expect(renderProjectTaskList(new Set([project.id]), activityFor(["completed"]))).not.toContain(
      "project-status",
    );
    expect(renderProjectTaskList(new Set(), activityFor([null, "failed"]))).not.toContain(
      "project-status",
    );
    const otherProjectActivity = new Map(
      [...activityFor(["completed"])].map(
        ([key, record]) => [key, { ...record, projectId: "other-project" }] as const,
      ),
    );
    expect(renderProjectTaskList(new Set(), otherProjectActivity)).not.toContain("project-status");
  });

  it("renders task loading state inside the expanded Project without shifting the tree", () => {
    const markup = renderProjectTaskList();

    const projectTreePosition = markup.indexOf('data-testid="project-tree-scroll"');
    const loadingPosition = markup.indexOf("正在加载任务");

    expect(projectTreePosition).toBeGreaterThanOrEqual(0);
    expect(loadingPosition).toBeGreaterThan(projectTreePosition);
    expect(markup).not.toContain("暂无任务");
    expect(markup).toMatch(
      /class="[^"]*opacity-0[^"]*focus-visible:opacity-100[^"]*group-hover\/temporary:opacity-100[^"]*"[^>]*aria-label="新建任务"/u,
    );
    expect(markup).toMatch(
      /class="[^"]*opacity-0[^"]*focus-visible:opacity-100[^"]*group-hover\/project:opacity-100[^"]*"[^>]*aria-label="在 Codexly 中新建任务"/u,
    );
    const worktreeAction = markup.indexOf('aria-label="在 Codexly 中创建 worktree 任务"');
    const regularAction = markup.indexOf('aria-label="在 Codexly 中新建任务"');
    expect(worktreeAction).toBeGreaterThan(0);
    expect(worktreeAction).toBeLessThan(regularAction);
  });

  it("keeps project actions visible on touch devices", () => {
    const markup = renderProjectTaskList(new Set());
    const css = readFileSync(
      new URL("../../../shared/styles/workbench.css", import.meta.url),
      "utf8",
    );

    for (const label of [
      "打开 Codexly 的项目操作菜单",
      "在 Codexly 中创建 worktree 任务",
      "在 Codexly 中新建任务",
    ]) {
      expect(markup).toMatch(
        new RegExp(`class="[^"]*project-hover-action[^"]*"[^>]*aria-label="${label}"`, "u"),
      );
    }
    expect(css).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?\.project-hover-action \{\s*opacity: 1;/u,
    );
  });
});
