import { expect, test } from "vitest";
import { createHarness, snapshot, task } from "./app-all.test-support.js";

const request = {
  method: "DELETE" as const,
  url: "/v1/projects/codexly/tasks/archived",
  headers: { "idempotency-key": "delete-archived" },
  payload: {},
};

test("replays a bulk deletion result without relisting newly archived tasks", async () => {
  const { app, listTasks, readTask, deleteTask } = await createHarness();
  listTasks.mockResolvedValue({ data: [task], nextCursor: null });
  readTask.mockResolvedValue(snapshot);
  const [first, concurrent] = await Promise.all([app.inject(request), app.inject(request)]);
  expect(first.statusCode).toBe(200);
  expect(first.json()).toEqual({ deletedCount: 1, failedCount: 0 });
  expect(concurrent.json()).toEqual(first.json());
  expect((await app.inject(request)).json()).toEqual(first.json());
  expect(listTasks).toHaveBeenCalledOnce();
  expect(listTasks).toHaveBeenCalledWith({ archived: true, limit: 100 });
  expect(deleteTask).toHaveBeenCalledExactlyOnceWith(task.id);
});

test("returns partial failure counts as a replayable response", async () => {
  const { app, listTasks, readTask, deleteTask } = await createHarness();
  listTasks.mockResolvedValue({ data: [task], nextCursor: null });
  readTask.mockResolvedValue(snapshot);
  deleteTask.mockRejectedValueOnce(new Error("Provider failed"));
  const response = await app.inject(request);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ deletedCount: 0, failedCount: 1 });
  expect((await app.inject(request)).json()).toEqual(response.json());
  expect(deleteTask).toHaveBeenCalledOnce();
});

test("requires an idempotency key and rejects unexpected task selectors", async () => {
  const { app, deleteTask } = await createHarness();
  expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(400);
  expect((await app.inject({ ...request, payload: { taskIds: ["active"] } })).statusCode).toBe(400);
  expect(deleteTask).not.toHaveBeenCalled();
});
