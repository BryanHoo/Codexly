import { expect, test } from "vitest";
import { createHarness } from "./app-all.test-support.js";
import { task } from "./app.test-support.js";

test("returns null when a readable task exists on a later pinned archive page", async () => {
  const { app, listTasks } = await createHarness();
  listTasks
    .mockResolvedValueOnce({ data: [], nextCursor: null })
    .mockResolvedValueOnce({ data: [], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [task], nextCursor: null });

  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/navigation",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ task: null });
  expect(listTasks).toHaveBeenLastCalledWith({
    archived: true,
    cursor: "next",
    limit: 100,
    pinnedOnly: true,
  });
});

test("returns null for a missing task without listing archives", async () => {
  const { app, listTasks } = await createHarness();
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/missing/navigation",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ task: null });
  expect(listTasks).not.toHaveBeenCalled();
});

test("normalizes an unavailable historical provider task", async () => {
  const { app, listTasks, readTask } = await createHarness();
  readTask.mockRejectedValue(new Error("no rollout found for thread task-1"));
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/navigation",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ task: null });
  expect(listTasks).not.toHaveBeenCalled();
});

test("returns a fresh task snapshot when neither archive partition contains it", async () => {
  const { app, listTasks } = await createHarness();
  listTasks.mockResolvedValue({ data: [], nextCursor: null });
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/navigation",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ task: { snapshot: { id: "task-1" } } });
  expect(listTasks).toHaveBeenCalledTimes(2);
});

test("rejects archive pagination that does not advance", async () => {
  const { app, listTasks } = await createHarness();
  listTasks.mockResolvedValue({ data: [], nextCursor: "stalled" });
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/navigation",
  });

  expect(response.statusCode).toBe(500);
  expect(listTasks).toHaveBeenCalledTimes(2);
});
