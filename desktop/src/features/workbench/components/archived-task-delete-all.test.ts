import { expect, test, vi } from "vitest";
import type { NativeArchivedTaskClient } from "../../projects/project-queries.js";
import { deleteAllArchivedTasks } from "./archived-task-delete-all.js";

const task = (id: string, updatedAt: string) => ({
  id,
  updatedAt,
  projectId: "project",
  pinned: false,
  title: id,
});
const cutoff = "2026-07-24T00:00:00.000Z";
function setup() {
  return {
    deleteTask: vi
      .fn<NativeArchivedTaskClient["deleteTask"]>()
      .mockImplementation(async (_project, taskId) => ({ status: "deleted", taskId })),
    listTasks: vi.fn<NativeArchivedTaskClient["listTasks"]>(),
    unarchiveTask: vi.fn<NativeArchivedTaskClient["unarchiveTask"]>(),
  };
}

test("collects matching tasks across all pages before deleting, independent of search", async () => {
  const client = setup();
  client.listTasks
    .mockResolvedValueOnce({ data: [task("new", "2026-10-24T00:00:00Z")], nextCursor: "older" })
    .mockResolvedValueOnce({
      data: [
        task("old", "2026-01-01T00:00:00Z"),
        task("boundary", cutoff),
        task("invalid", "invalid"),
      ],
      nextCursor: null,
    });
  await deleteAllArchivedTasks(client, "project", { updatedBefore: cutoff });
  expect(client.deleteTask).toHaveBeenCalledExactlyOnceWith("project", "old");
  expect(client.listTasks).toHaveBeenNthCalledWith(2, "project", {
    archived: true,
    cursor: "older",
    limit: 100,
  });
  expect(client.listTasks.mock.invocationCallOrder[1]).toBeLessThan(
    client.deleteTask.mock.invocationCallOrder[0]!,
  );
});

test("preserves delete-all and reports failures after attempting the full selection", async () => {
  const client = setup();
  client.listTasks.mockResolvedValue({
    data: [task("a", cutoff), task("b", cutoff)],
    nextCursor: null,
  });
  client.deleteTask.mockRejectedValueOnce(new Error("failed"));
  await expect(deleteAllArchivedTasks(client, "project")).rejects.toThrow("failed");
  expect(client.deleteTask).toHaveBeenCalledTimes(2);
});

test("does not delete anything when no task matches or the cutoff is invalid", async () => {
  const client = setup();
  client.listTasks.mockResolvedValue({ data: [task("boundary", cutoff)], nextCursor: null });
  await deleteAllArchivedTasks(client, "project", { updatedBefore: cutoff });
  expect(client.deleteTask).not.toHaveBeenCalled();
  await expect(
    deleteAllArchivedTasks(client, "project", { updatedBefore: "invalid" }),
  ).rejects.toThrow("cutoff");
  expect(client.listTasks).toHaveBeenCalledTimes(1);
});

test("refuses repeated pagination before deleting selected tasks", async () => {
  const client = setup();
  client.listTasks.mockResolvedValue({
    data: [task("old", "2026-01-01T00:00:00Z")],
    nextCursor: "loop",
  });
  await expect(
    deleteAllArchivedTasks(client, "project", { updatedBefore: cutoff }),
  ).rejects.toThrow("repeated cursor");
  expect(client.deleteTask).not.toHaveBeenCalled();
});
