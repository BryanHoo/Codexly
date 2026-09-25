import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const temporaryRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary",
});
