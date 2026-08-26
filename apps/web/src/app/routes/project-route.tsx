import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId",
});
