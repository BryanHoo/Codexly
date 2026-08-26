import { createRoute } from "@tanstack/react-router";

import { WorkbenchRoute, workbenchLayoutRoute } from "./workbench-route.js";

export const projectRoute = createRoute({
  component: ProjectPage,
  getParentRoute: () => workbenchLayoutRoute,
  path: "p/$projectId",
});

function ProjectPage() {
  const { projectId } = projectRoute.useParams();
  return <WorkbenchRoute projectId={projectId} />;
}
