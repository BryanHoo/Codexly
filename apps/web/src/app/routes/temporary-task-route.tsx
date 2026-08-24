import { TEMPORARY_TASK_SCOPE_ID } from "@code-agent/protocol";
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";
import { WorkbenchRoute } from "./workbench-route.js";

export const temporaryTaskRoute = createRoute({
  component: TemporaryTaskPage,
  getParentRoute: () => rootRoute,
  path: "/temporary/t/$taskId",
});

function TemporaryTaskPage() {
  const { taskId } = temporaryTaskRoute.useParams();
  return <WorkbenchRoute projectId={TEMPORARY_TASK_SCOPE_ID} taskId={taskId} temporary />;
}
