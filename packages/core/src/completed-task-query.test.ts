import { expect, test, vi } from "vitest";
import type { AgentProvider } from "./agent-provider.js";
import { queryCompletedTasks } from "./completed-task-query.js";

const task = (projectId: string, updatedAt: string) => ({
  id: "task",
  projectId,
  title: projectId,
  pinned: false,
  updatedAt,
});

test("merges pages by recency and skips exhausted scopes on the next request", async () => {
  const a = task("a", "2026-09-01T00:00:00Z");
  const b = task("b", "2026-09-02T00:00:00Z");
  const listA = vi
    .fn<AgentProvider["listTasks"]>()
    .mockResolvedValueOnce({ data: [a, a], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [], nextCursor: null });
  const listB = vi
    .fn<AgentProvider["listTasks"]>()
    .mockResolvedValue({ data: [b], nextCursor: null });
  const resolve = (id: string) => Promise.resolve({ listTasks: id === "a" ? listA : listB });
  const first = await queryCompletedTasks(resolve, { projectIds: ["a", "b"] });
  expect(first).toEqual({ data: [b, a], nextCursor: { a: "next", b: null } });
  expect(listA).toHaveBeenCalledWith({ completed: true, limit: 5 });
  if (first.nextCursor === null) throw new Error("Expected continuation cursor");
  expect(
    await queryCompletedTasks(resolve, { projectIds: ["a", "b"], cursor: first.nextCursor }),
  ).toEqual({ data: [], nextCursor: null });
  expect(listB).toHaveBeenCalledOnce();
  expect(listA).toHaveBeenLastCalledWith({ completed: true, limit: 10, cursor: "next" });
});

test("rejects mismatched cursor scopes before reading providers", async () => {
  const resolve = vi.fn();
  await expect(
    queryCompletedTasks(resolve, { projectIds: ["a"], cursor: { other: "next" } }),
  ).rejects.toThrow("cursor");
  expect(resolve).not.toHaveBeenCalled();
});

test("rejects foreign tasks and repeated cursors rather than returning incomplete results", async () => {
  const listTasks = vi
    .fn<AgentProvider["listTasks"]>()
    .mockResolvedValue({ data: [task("foreign", "2026-09-01T00:00:00Z")], nextCursor: null });
  const resolve = () => Promise.resolve({ listTasks });
  await expect(queryCompletedTasks(resolve, { projectIds: ["a"] })).rejects.toThrow("scope");
  listTasks.mockResolvedValue({ data: [], nextCursor: "same" });
  await expect(
    queryCompletedTasks(resolve, { projectIds: ["a"], cursor: { a: "same" } }),
  ).rejects.toThrow("cursor");
});

test("bounds simultaneous scope reads to four", async () => {
  const releases: (() => void)[] = [];
  const listTasks = vi.fn<AgentProvider["listTasks"]>().mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(() => {
          resolve({ data: [], nextCursor: null });
        });
      }),
  );
  const result = queryCompletedTasks(() => Promise.resolve({ listTasks }), {
    projectIds: ["a", "b", "c", "d", "e"],
  });
  await vi.waitFor(() => {
    expect(listTasks).toHaveBeenCalledTimes(4);
  });
  for (const release of releases.splice(0)) release();
  await vi.waitFor(() => {
    expect(listTasks).toHaveBeenCalledTimes(5);
  });
  releases[0]?.();
  expect(await result).toEqual({ data: [], nextCursor: null });
});
