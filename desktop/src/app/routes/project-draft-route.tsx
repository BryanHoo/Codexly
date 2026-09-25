import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectDraftRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/todo/$draftId",
});
