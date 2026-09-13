import { expect, test } from "vitest";
import { createHarness, task } from "./app-all.test-support.js";

test("queries completed tasks through one read-only aggregate endpoint", async () => {
  const { app, listTasks } = await createHarness();
  listTasks.mockResolvedValue({ data: [task], nextCursor: "next" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/tasks/completed/query",
    payload: { projectIds: ["codexly"] },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: [task], nextCursor: { codexly: "next" } });
  expect(listTasks).toHaveBeenCalledExactlyOnceWith({ completed: true, limit: 10 });
});

test("rejects duplicate scopes and mismatched cursor keys", async () => {
  const { app, listTasks } = await createHarness();
  for (const payload of [
    { projectIds: ["codexly", "codexly"] },
    { projectIds: ["codexly"], cursor: { other: "next" } },
  ]) {
    expect(
      (await app.inject({ method: "POST", url: "/v1/tasks/completed/query", payload })).statusCode,
    ).toBe(400);
  }
  expect(listTasks).not.toHaveBeenCalled();
});
