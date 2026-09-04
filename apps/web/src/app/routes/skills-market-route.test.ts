import { describe, expect, it } from "vitest";

import "../router.js";
import { projectSkillsMarketRoute, temporarySkillsMarketRoute } from "./skills-market-route.js";

describe("Skills & MCP 路由", () => {
  it("保持项目与临时工作区路径稳定", () => {
    expect(projectSkillsMarketRoute.fullPath).toBe("/p/$projectId/skills");
    expect(temporarySkillsMarketRoute.fullPath).toBe("/temporary/skills");
  });
});
