import { lazy, Suspense } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import type { WorkbenchShellProps } from "../../features/workbench/components/workbench-shell-runtime.js";

export function loadWorkbenchShell() {
  return import("../../features/workbench/components/workbench-shell.js");
}

const DeferredWorkbenchShell = lazy(() =>
  loadWorkbenchShell().then((module) => ({ default: module.WorkbenchShell })),
);

export function WorkbenchRoute(props: WorkbenchShellProps) {
  const { t } = useTranslation("common");
  return (
    <Suspense
      fallback={
        <main
          className="grid h-full place-items-center text-sm text-muted-foreground"
          role="status"
        >
          {t("app.loadingProjects")}
        </main>
      }
    >
      <DeferredWorkbenchShell {...props} />
    </Suspense>
  );
}
