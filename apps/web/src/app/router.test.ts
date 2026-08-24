import { describe, expect, it } from "vitest";

import { projectRoute } from "./routes/project-route.js";
import { taskRoute } from "./routes/task-route.js";

describe("workbench route code splitting", () => {
  it.each([
    ["project", projectRoute],
    ["task", taskRoute],
  ])("routes the %s page through the shared workbench boundary", (_, route) => {
    // 路由参数映射保持静态，工作台实现统一交给共享 Suspense 边界加载。
    expect(route.options.component).toBeTypeOf("function");
    expect(route.lazyFn).toBeUndefined();
  });
});
