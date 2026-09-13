import { expect, test, vi } from "vitest";
import type { AgentProvider } from "./agent-provider.js";
import { listTaskCatalog } from "./task-catalog.js";

const task = {
  id: "a",
  projectId: "project",
  pinned: true,
  title: "new",
  updatedAt: "2026-09-13T00:00:00Z",
};

test("collects pinned pages and keeps the first version of overlapping tasks", async () => {
  const listTasks = vi
    .fn<AgentProvider["listTasks"]>()
    .mockResolvedValueOnce({ data: [task], nextCursor: "next" })
    .mockResolvedValueOnce({
      data: [
        { ...task, title: "old" },
        { ...task, id: "b" },
      ],
      nextCursor: null,
    });
  expect(await listTaskCatalog({ listTasks }, "project", { pinned: true })).toEqual({
    data: [task, { ...task, id: "b" }],
  });
  expect(listTasks.mock.calls).toEqual([
    [{ limit: 100, pinnedOnly: true }],
    [{ limit: 100, pinnedOnly: true, cursor: "next" }],
  ]);
});

test("rejects repeated cursors and foreign scope data instead of returning a partial catalog", async () => {
  const listTasks = vi
    .fn<AgentProvider["listTasks"]>()
    .mockResolvedValue({ data: [task], nextCursor: "same" });
  await expect(listTaskCatalog({ listTasks }, "project")).rejects.toThrow("cursor");
  listTasks.mockResolvedValue({ data: [task], nextCursor: null });
  await expect(listTaskCatalog({ listTasks }, "temporary")).rejects.toThrow("scope");
});

test("bounds both catalog size and empty pagination", async () => {
  const listTasks = vi.fn<AgentProvider["listTasks"]>().mockResolvedValue({
    data: Array.from({ length: 10001 }, (_, i) => ({ ...task, id: String(i) })),
    nextCursor: null,
  });
  await expect(listTaskCatalog({ listTasks }, "project")).rejects.toThrow("limit");
  let page = 0;
  listTasks
    .mockClear()
    .mockImplementation(() => Promise.resolve({ data: [], nextCursor: String(page++) }));
  await expect(listTaskCatalog({ listTasks }, "project")).rejects.toThrow("limit");
  expect(listTasks).toHaveBeenCalledTimes(1000);
});
