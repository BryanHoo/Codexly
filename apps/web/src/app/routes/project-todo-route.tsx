import { createRoute } from "@tanstack/react-router";

import { workbenchLayoutRoute } from "./workbench-route.js";

export const projectTodoRoute = createRoute({
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/todo/$todoId",
});
