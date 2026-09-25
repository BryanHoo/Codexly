import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const taskRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/t/$taskId",
});
