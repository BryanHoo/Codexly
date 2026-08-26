import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const temporaryTaskRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/t/$taskId",
});
