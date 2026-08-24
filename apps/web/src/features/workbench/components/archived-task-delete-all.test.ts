import type { AgentTask, AgentTaskPage } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";

import type { CodeAgentArchivedTaskClient } from "../../projects/project-queries.js";
import { deleteAllArchivedTasks } from "./archived-task-delete-all.js";

function task(id: string): AgentTask {
  return {
    id,
    pinned: false,
    projectId: "code-agent",
    title: id,
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}

function clientWithPages(pages: readonly AgentTaskPage[], deleteTask = vi.fn()) {
  const listTasks = vi.fn();
  for (const page of pages) listTasks.mockResolvedValueOnce(page);
  return {
    client: { deleteTask, listTasks } as unknown as CodeAgentArchivedTaskClient,
    deleteTask,
    listTasks,
  };
}

describe("deleteAllArchivedTasks", () => {
  it("lists every archived page and deletes each unique task", async () => {
    const { client, deleteTask, listTasks } = clientWithPages([
      { data: [task("task-1"), task("task-2")], nextCursor: "next-page" },
      { data: [task("task-2"), task("task-3")], nextCursor: null },
    ]);
    deleteTask.mockImplementation((_projectId: string, taskId: string) =>
      Promise.resolve({ status: "deleted" as const, taskId }),
    );

    await deleteAllArchivedTasks(client, "code-agent");

    expect(listTasks).toHaveBeenNthCalledWith(1, "code-agent", {
      archived: true,
      limit: 100,
    });
    expect(listTasks).toHaveBeenNthCalledWith(2, "code-agent", {
      archived: true,
      cursor: "next-page",
      limit: 100,
    });
    expect(deleteTask).toHaveBeenNthCalledWith(1, "code-agent", "task-1");
    expect(deleteTask).toHaveBeenNthCalledWith(2, "code-agent", "task-2");
    expect(deleteTask).toHaveBeenNthCalledWith(3, "code-agent", "task-3");
  });

  it("attempts every task before reporting a deletion failure", async () => {
    const failure = new Error("delete failed");
    const deleteTask = vi.fn((_projectId: string, taskId: string) => {
      if (taskId === "task-2") return Promise.reject(failure);
      return Promise.resolve({ status: "deleted" as const, taskId });
    });
    const { client } = clientWithPages(
      [{ data: [task("task-1"), task("task-2"), task("task-3")], nextCursor: null }],
      deleteTask,
    );

    await expect(deleteAllArchivedTasks(client, "code-agent")).rejects.toBe(failure);
    expect(deleteTask).toHaveBeenCalledTimes(3);
  });

  it("limits concurrent deletions to four tasks", async () => {
    let activeDeletions = 0;
    let maximumActiveDeletions = 0;
    const releases: (() => void)[] = [];
    const deleteTask = vi.fn(
      (_projectId: string, taskId: string) =>
        new Promise<{ status: "deleted"; taskId: string }>((resolve) => {
          activeDeletions += 1;
          maximumActiveDeletions = Math.max(maximumActiveDeletions, activeDeletions);
          releases.push(() => {
            activeDeletions -= 1;
            resolve({ status: "deleted", taskId });
          });
        }),
    );
    const tasks = Array.from({ length: 5 }, (_, index) => task(`task-${String(index + 1)}`));
    const { client } = clientWithPages([{ data: tasks, nextCursor: null }], deleteTask);

    const deletion = deleteAllArchivedTasks(client, "code-agent");
    await vi.waitFor(() => {
      expect(deleteTask).toHaveBeenCalledTimes(4);
    });
    expect(maximumActiveDeletions).toBe(4);
    for (const release of releases.splice(0)) release();
    await vi.waitFor(() => {
      expect(deleteTask).toHaveBeenCalledTimes(5);
    });
    releases[0]?.();
    await deletion;

    expect(maximumActiveDeletions).toBe(4);
  });

  it("rejects a repeated archived page cursor before deleting", async () => {
    const { client, deleteTask } = clientWithPages([
      { data: [task("task-1")], nextCursor: "repeated" },
      { data: [task("task-2")], nextCursor: "repeated" },
    ]);

    await expect(deleteAllArchivedTasks(client, "code-agent")).rejects.toThrow(
      "Archived task pagination returned a repeated cursor",
    );
    expect(deleteTask).not.toHaveBeenCalled();
  });
});
