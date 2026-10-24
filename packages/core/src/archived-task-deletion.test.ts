import { expect, test, vi } from "vitest";
import type { AgentProvider } from "./agent-provider.js";
import { deleteArchivedTasks } from "./archived-task-deletion.js";

const task = (id: string, projectId = "project") => ({
  id,
  projectId,
  pinned: false,
  title: id,
  updatedAt: "2026-09-13T00:00:00.000Z",
});
function setup() {
  const listTasks = vi.fn<AgentProvider["listTasks"]>();
  const deleteTask = vi.fn<AgentProvider["deleteTask"]>().mockResolvedValue();
  const readTask = vi.fn<AgentProvider["readTask"]>().mockImplementation((id) =>
    Promise.resolve({
      ...task(id),
      turns: [],
      pendingRequests: [],
      status: "idle",
      contextUsage: null,
      goal: null,
      plan: null,
      turnsNextCursor: null,
    }),
  );
  return { listTasks, deleteTask, readTask };
}

test("collects all pages before deleting unique archived tasks", async () => {
  const provider = setup();
  provider.listTasks
    .mockResolvedValueOnce({ data: [task("a"), task("b")], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [task("b"), task("c")], nextCursor: null });
  expect(await deleteArchivedTasks(provider, "project")).toEqual({
    deletedCount: 3,
    failedCount: 0,
  });
  expect(provider.listTasks).toHaveBeenNthCalledWith(1, { archived: true, limit: 100 });
  expect(provider.listTasks).toHaveBeenNthCalledWith(2, {
    archived: true,
    limit: 100,
    cursor: "next",
  });
  expect(provider.deleteTask.mock.calls).toEqual([["a"], ["b"], ["c"]]);
});

test("selects only archived tasks strictly older than the cutoff across pages", async () => {
  const provider = setup();
  provider.listTasks
    .mockResolvedValueOnce({
      data: [task("old"), { ...task("boundary"), updatedAt: "2026-10-01T00:00:00Z" }],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      data: [
        { ...task("new"), updatedAt: "2026-10-02T00:00:00Z" },
        { ...task("invalid"), updatedAt: "unknown" },
        task("old-page-2"),
      ],
      nextCursor: null,
    });
  expect(
    await deleteArchivedTasks(provider, "project", { updatedBefore: "2026-10-01T00:00:00Z" }),
  ).toEqual({ deletedCount: 2, failedCount: 0 });
  expect(provider.deleteTask.mock.calls).toEqual([["old"], ["old-page-2"]]);
});

test("rechecks the selected task timestamp before deleting", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValue({ data: [task("changed")], nextCursor: null });
  const changedTask = await provider.readTask("changed");
  if (changedTask === undefined) throw new Error("Missing task fixture");
  provider.readTask.mockResolvedValue({
    ...changedTask,
    updatedAt: "2026-10-02T00:00:00Z",
  });
  expect(
    await deleteArchivedTasks(provider, "project", { updatedBefore: "2026-10-01T00:00:00Z" }),
  ).toEqual({ deletedCount: 0, failedCount: 1 });
  expect(provider.deleteTask).not.toHaveBeenCalled();
});

test("rejects an invalid cutoff before listing or deleting", async () => {
  const provider = setup();
  await expect(
    deleteArchivedTasks(provider, "project", { updatedBefore: "invalid" }),
  ).rejects.toThrow("cutoff");
  expect(provider.listTasks).not.toHaveBeenCalled();
  expect(provider.deleteTask).not.toHaveBeenCalled();
});

test("rejects repeated cursors before any destructive call", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValue({ data: [task("a")], nextCursor: "repeat" });
  await expect(deleteArchivedTasks(provider, "project")).rejects.toThrow("repeated cursor");
  expect(provider.deleteTask).not.toHaveBeenCalled();
});

test("reports partial failures after attempting every selected task", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValue({
    data: [task("a"), task("b"), task("c")],
    nextCursor: null,
  });
  provider.deleteTask.mockRejectedValueOnce(new Error("delete failed"));
  expect(await deleteArchivedTasks(provider, "project")).toEqual({
    deletedCount: 2,
    failedCount: 1,
  });
  expect(provider.deleteTask).toHaveBeenCalledTimes(3);
});

test("rejects foreign scope listings and checks ownership again before deletion", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValueOnce({ data: [task("foreign", "other")], nextCursor: null });
  await expect(deleteArchivedTasks(provider, "project")).rejects.toThrow("scope");
  expect(provider.deleteTask).not.toHaveBeenCalled();
  provider.listTasks.mockResolvedValue({ data: [task("a")], nextCursor: null });
  provider.readTask.mockResolvedValue(undefined);
  expect(await deleteArchivedTasks(provider, "project")).toEqual({
    deletedCount: 0,
    failedCount: 1,
  });
  expect(provider.deleteTask).not.toHaveBeenCalled();
});

test("limits deletion concurrency to four", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValue({
    data: Array.from({ length: 5 }, (_, i) => task(String(i))),
    nextCursor: null,
  });
  const releases: (() => void)[] = [];
  provider.deleteTask.mockImplementation(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  const deleting = deleteArchivedTasks(provider, "project");
  await vi.waitFor(() => {
    expect(provider.deleteTask).toHaveBeenCalledTimes(4);
  });
  for (const release of releases.splice(0)) release();
  await vi.waitFor(() => {
    expect(provider.deleteTask).toHaveBeenCalledTimes(5);
  });
  releases[0]?.();
  expect(await deleting).toEqual({ deletedCount: 5, failedCount: 0 });
});

test("rejects excessive target sets before deleting anything", async () => {
  const provider = setup();
  provider.listTasks.mockResolvedValue({
    data: Array.from({ length: 10001 }, (_, i) => task(String(i))),
    nextCursor: null,
  });
  await expect(deleteArchivedTasks(provider, "project")).rejects.toThrow("limit");
  expect(provider.deleteTask).not.toHaveBeenCalled();
});

test("bounds empty pagination with unique cursors before deletion", async () => {
  const provider = setup();
  let page = 0;
  provider.listTasks.mockImplementation(() =>
    Promise.resolve({ data: [], nextCursor: String(page++) }),
  );
  await expect(deleteArchivedTasks(provider, "project")).rejects.toThrow("limit");
  expect(provider.listTasks).toHaveBeenCalledTimes(1000);
  expect(provider.deleteTask).not.toHaveBeenCalled();
});
