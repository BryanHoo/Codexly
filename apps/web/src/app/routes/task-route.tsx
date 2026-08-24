import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";
import { WorkbenchRoute } from "./workbench-route.js";

export const taskRoute = createRoute({
  component: TaskPage,
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/t/$taskId",
});

function TaskPage() {
  const { projectId, taskId } = taskRoute.useParams();
  return <WorkbenchRoute projectId={projectId} taskId={taskId} />;
}
