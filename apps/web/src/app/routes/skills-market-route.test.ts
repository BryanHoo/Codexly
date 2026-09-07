import { describe, expect, it } from "vitest";

import "../router.js";
import { projectSkillsMarketRoute, temporarySkillsMarketRoute } from "./skills-market-route.js";

describe("扩展中心路由", () => {
  it("保持项目与临时工作区路径稳定", () => {
    expect(projectSkillsMarketRoute.fullPath).toBe("/p/$projectId/extensions/$section");
    expect(temporarySkillsMarketRoute.fullPath).toBe("/temporary/extensions/$section");
  });
});
