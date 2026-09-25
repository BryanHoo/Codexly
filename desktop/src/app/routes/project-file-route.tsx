import { createRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { parseProjectFilePopupSearch } from "../../features/workbench/project-file-popup.js";
import { rootRoute } from "./root-route.js";

export const projectFileRoute = createRoute({
  component: ProjectFileRoute,
  getParentRoute: () => rootRoute,
  path: "p/$projectId/file",
  validateSearch: parseProjectFilePopupSearch,
});

function loadProjectFilePopupPage() {
  return import("../../features/workbench/components/project-file-popup-page.js");
}

const DeferredProjectFilePopupPage = lazy(() =>
  loadProjectFilePopupPage().then((module) => ({ default: module.ProjectFilePopupPage })),
);

function ProjectFileRoute() {
  const { projectId } = projectFileRoute.useParams();
  const search = projectFileRoute.useSearch();
  return (
    <Suspense fallback={null}>
      <DeferredProjectFilePopupPage projectId={projectId} search={search} />
    </Suspense>
  );
}
