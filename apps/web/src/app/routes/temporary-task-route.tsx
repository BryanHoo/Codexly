import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { createRoute } from "@tanstack/react-router";

import { WorkbenchRoute, workbenchLayoutRoute } from "./workbench-route.js";

export const temporaryTaskRoute = createRoute({
  component: TemporaryTaskPage,
  getParentRoute: () => workbenchLayoutRoute,
  path: "temporary/t/$taskId",
});

function TemporaryTaskPage() {
  const { taskId } = temporaryTaskRoute.useParams();
  return <WorkbenchRoute projectId={TEMPORARY_TASK_SCOPE_ID} taskId={taskId} temporary />;
}
