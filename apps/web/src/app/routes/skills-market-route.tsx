import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectSkillsMarketRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/skills",
});

export const temporarySkillsMarketRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/skills",
});
