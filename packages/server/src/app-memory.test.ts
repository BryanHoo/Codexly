import { expect, it, vi } from "vitest";
import { createHarness } from "./app-all.test-support.js";

it.each(["# Memory\n项目记忆", null])("通过认证路由返回摘要与正常空值 %s", async (summary) => {
  const { app, provider } = await createHarness();
  const read = vi.fn(() => Promise.resolve({ status: "ready", summary } as const));
  provider.readThreadMemory = read;
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/memory",
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.json()).toEqual({ status: "ready", summary });
  expect(read).toHaveBeenCalledExactlyOnceWith("task-1");
});

it("缺失任务不能调用记忆接口", async () => {
  const { app, provider } = await createHarness();
  const read = vi.fn();
  provider.readThreadMemory = read;
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/missing/memory",
  });
  expect(response.statusCode).toBe(404);
  expect(read).not.toHaveBeenCalled();
});

it("没有能力的 Provider 返回明确状态", async () => {
  const { app } = await createHarness();
  const response = await app.inject({
    method: "GET",
    url: "/v1/projects/codexly/tasks/task-1/memory",
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "unsupported", summary: null });
});
