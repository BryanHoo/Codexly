import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatTaskAge,
  getPinnedTasks,
  getProjectTaskPreview,
  PROJECT_TASK_PREVIEW_LIMIT,
} from "./project-data.js";

describe("project navigation data", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no pinned section data when every task is unpinned", () => {
    expect(
      getPinnedTasks([
        {
          id: "task-1",
          pinned: false,
          projectId: "demo",
          title: "Demo task",
          updatedAt: "2026-07-22T08:00:00.000Z",
        },
      ]),
    ).toEqual([]);
  });

  it("shows five tasks by default and all tasks only after expansion", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      id: `task-${String(index + 1)}`,
      pinned: false,
      projectId: "demo",
      title: `Task ${String(index + 1)}`,
      updatedAt: "2026-07-22T08:00:00.000Z",
    }));

    expect(PROJECT_TASK_PREVIEW_LIMIT).toBe(5);
    expect(getProjectTaskPreview(tasks, false)).toEqual({
      hasMore: true,
      tasks: tasks.slice(0, 5),
    });
    expect(getProjectTaskPreview(tasks, true)).toEqual({ hasMore: false, tasks });
    expect(getProjectTaskPreview(tasks.slice(0, 5), false)).toEqual({
      hasMore: false,
      tasks: tasks.slice(0, 5),
    });
  });

  it("shows task age with the smallest suitable time unit", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-05T08:30:00.000Z"));

    expect(formatTaskAge("2026-08-05T08:00:00.000Z")).toBe("30m");
    expect(formatTaskAge("2026-08-05T08:29:30.000Z")).toBe("1m");
    expect(formatTaskAge("2026-08-05T07:30:00.000Z")).toBe("1h");
    expect(formatTaskAge("2026-08-04T08:30:00.000Z")).toBe("1d");
  });
});
