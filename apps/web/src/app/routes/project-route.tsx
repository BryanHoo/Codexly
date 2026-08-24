import { createRoute } from "@tanstack/react-router";

import { rootRoute } from "./root-route.js";
import { WorkbenchRoute } from "./workbench-route.js";

export const projectRoute = createRoute({
  component: ProjectPage,
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
});

function ProjectPage() {
  const { projectId } = projectRoute.useParams();
  return <WorkbenchRoute projectId={projectId} />;
}
