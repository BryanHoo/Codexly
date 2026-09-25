import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectScheduledTasksRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/scheduled",
});

export const temporaryScheduledTasksRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/scheduled",
});
