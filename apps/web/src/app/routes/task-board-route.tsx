import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectTaskBoardRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/board",
});

export const temporaryTaskBoardRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/board",
});
