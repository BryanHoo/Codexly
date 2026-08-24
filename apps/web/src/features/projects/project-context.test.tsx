import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import type { AgentTask } from "@codexly/protocol";

import {
  buildTaskScopeCollections,
  useProjectData,
  type ProjectTaskQueryResult,
} from "./project-context.js";

const projects = [
  {
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "project-1",
    name: "Project 1",
    roots: [{ path: "/workspace/project-1" }],
  },
  {
    createdAt: "2026-08-02T00:00:00.000Z",
    id: "project-2",
    name: "Project 2",
    roots: [{ path: "/workspace/project-2" }],
  },
] as const;

describe("Project Context", () => {
  it("builds task collections only for queried projects", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "project-1",
      title: "拆分 Context",
      updatedAt: "2026-08-02T00:01:00.000Z",
    } as const;
    const projectTaskResults = new Map<string, ProjectTaskQueryResult>([
      [
        "project-1",
        {
          controller: { fetchNextPage: vi.fn(() => Promise.resolve()) },
          state: {
            error: null,
            hasNextPage: true,
            isFetchingNextPage: false,
            isPending: false,
          },
          tasks: [task],
        },
      ],
    ]);

    const temporaryTask: AgentTask = {
      ...task,
      id: "temporary-task",
      projectId: TEMPORARY_TASK_SCOPE_ID,
    };
    projectTaskResults.set(TEMPORARY_TASK_SCOPE_ID, {
      controller: { fetchNextPage: vi.fn(() => Promise.resolve()) },
      state: {
        error: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        isPending: false,
      },
      tasks: [temporaryTask],
    });

    const result = buildTaskScopeCollections(
      [...projects.map((project) => project.id), TEMPORARY_TASK_SCOPE_ID],
      projectTaskResults,
    );

    expect(result.tasks).toEqual([task, temporaryTask]);
    expect(result.projectTaskStates.get("project-1")).toEqual(
      projectTaskResults.get("project-1")?.state,
    );
    expect(result.projectTaskStates.get("project-2")).toMatchObject({
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      isPending: true,
    });
    expect(result.projectTaskStates.get(TEMPORARY_TASK_SCOPE_ID)?.isPending).toBe(false);
  });

  it("requires the dedicated data provider", () => {
    function DataConsumer() {
      useProjectData();
      return null;
    }

    expect(() => renderToStaticMarkup(<DataConsumer />)).toThrow(
      "useProjectData must be used inside ProjectProvider",
    );
  });
});
