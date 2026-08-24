import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";
import { WorkbenchRoute } from "./workbench-route.js";

export const temporaryRoute = createRoute({
  component: TemporaryPage,
  getParentRoute: () => rootRoute,
  path: "/temporary",
});

function TemporaryPage() {
  return <WorkbenchRoute projectId={TEMPORARY_TASK_SCOPE_ID} temporary />;
}
