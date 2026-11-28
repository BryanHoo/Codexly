import { expect, it } from "vitest";

import { router } from "../router.js";

it("项目和临时工作区均不再注册扩展页面", () => {
  const paths = Object.keys(router.routesByPath);
  expect(paths).not.toContain("/p/$projectId/extensions/$section");
  expect(paths).not.toContain("/temporary/extensions/$section");
});
