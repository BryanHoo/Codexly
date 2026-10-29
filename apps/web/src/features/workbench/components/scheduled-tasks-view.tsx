import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import { lazy, Suspense } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
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
  const { t } = useTranslation("workbench");
  return (
    <Suspense
      fallback={
        <LoadingSkeleton
          variant="cards"
          className="flex-1 p-6"
          label={t("scheduledTasks.loading")}
        />
      }
    >
      <LazyScheduledTasksContainer {...props} />
    </Suspense>
  );
}
