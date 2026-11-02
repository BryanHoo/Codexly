import { expect, test, vi } from "vitest";
import { createHarness } from "./app-all.test-support.js";

test.each([false, true, undefined])(
  "queries archive state once by identity (%s) without scanning 202 archive pages",
  async (archived) => {
    const { app, provider, listTasks } = await createHarness();
    // 每个归档分区准备 101 页；导航不能随归档量增加列表请求。
    listTasks.mockImplementation((input) => {
      const page = Number(input?.cursor ?? 0);
      return Promise.resolve({ data: [], nextCursor: page < 100 ? String(page + 1) : null });
    });
    const isTaskArchived = vi.fn(() => Promise.resolve(archived));
    Object.assign(provider, { isTaskArchived });
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/codexly/tasks/task-1/navigation",
    });
    expect(response.statusCode).toBe(200);
    if (archived === false)
      expect(response.json()).toMatchObject({ task: { snapshot: { id: "task-1" } } });
    else expect(response.json()).toEqual({ task: null });
    expect(isTaskArchived).toHaveBeenCalledExactlyOnceWith("task-1");
    expect(listTasks).not.toHaveBeenCalled();
  },
);

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
