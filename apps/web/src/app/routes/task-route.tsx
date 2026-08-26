import { createRoute } from "@tanstack/react-router";

import { WorkbenchRoute, workbenchLayoutRoute } from "./workbench-route.js";

export const taskRoute = createRoute({
  component: TaskPage,
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId/t/$taskId",
});

function TaskPage() {
  const { projectId, taskId } = taskRoute.useParams();
  return <WorkbenchRoute projectId={projectId} taskId={taskId} />;
}
