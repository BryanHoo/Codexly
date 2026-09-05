import { describe, expect, it } from "vitest";

import { projectRoute } from "./routes/project-route.js";
import { taskRoute } from "./routes/task-route.js";
import {
  projectScheduledTasksRoute,
  temporaryScheduledTasksRoute,
} from "./routes/scheduled-tasks-route.js";
import { workbenchLayoutRoute } from "./routes/workbench-route.js";

describe("workbench route code splitting", () => {
  it.each([
    ["project", projectRoute],
    ["task", taskRoute],
    ["project scheduled tasks", projectScheduledTasksRoute],
    ["temporary scheduled tasks", temporaryScheduledTasksRoute],
  ])("routes the %s page through the shared workbench boundary", (_, route) => {
    // 叶子路由只负责参数匹配，共同父路由持有唯一 Shell，避免切换时重挂载工作台。
    expect(workbenchLayoutRoute.options.component).toBeTypeOf("function");
    expect(route.options.component).toBeUndefined();
    expect(route.lazyFn).toBeUndefined();
  });
});
