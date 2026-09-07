import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectSkillsMarketRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/extensions/$section",
});

export const temporarySkillsMarketRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/extensions/$section",
});
