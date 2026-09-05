import { lazy, Suspense } from "react";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

const LazyScheduledTasksContainer = lazy(() =>
  import("../../scheduled-tasks/scheduled-tasks-container.js").then((module) => ({
    default: module.ScheduledTasksContainer,
  })),
);

export function ScheduledTasksView(
  props: Readonly<{
    context: ReturnType<typeof useWorkbenchShellController>;
    projectId: string;
    temporary: boolean;
  }>,
) {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <LazyScheduledTasksContainer {...props} />
    </Suspense>
  );
}
