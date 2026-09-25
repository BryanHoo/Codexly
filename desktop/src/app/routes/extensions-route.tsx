import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectExtensionsRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/extensions/$section",
});

export const temporaryExtensionsRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/extensions/$section",
});
