import { expect, test } from "vitest";
import { createHarness, task } from "./app-all.test-support.js";

test("serves a complete pinned catalog through one request", async () => {
  const { app, listTasks } = await createHarness();
  listTasks
    .mockResolvedValueOnce({ data: [task], nextCursor: "next" })
    .mockResolvedValueOnce({ data: [task, { ...task, id: "second" }], nextCursor: null });
  const response = await app.inject("/v1/projects/codexly/tasks/catalog?pinned=true");
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: [task, { ...task, id: "second" }] });
  expect(listTasks).toHaveBeenNthCalledWith(2, { limit: 100, pinnedOnly: true, cursor: "next" });
});

test("returns an error for incomplete catalogs and missing projects", async () => {
  const { app, listTasks } = await createHarness();
  listTasks.mockResolvedValue({ data: [task], nextCursor: "repeat" });
  expect(
    (await app.inject("/v1/projects/codexly/tasks/catalog")).statusCode,
  ).toBeGreaterThanOrEqual(500);
  expect((await app.inject("/v1/projects/missing/tasks/catalog")).statusCode).toBe(404);
});
