import { Outlet, createRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import type { WorkbenchShellProps } from "../../features/workbench/components/workbench-shell-runtime.js";
import { WorkbenchBackground } from "../../features/workbench/components/workbench-background.js";
import { rootRoute } from "./root-route.js";

export const workbenchLayoutRoute = createRoute({
  component: WorkbenchLayout,
  getParentRoute: () => rootRoute,
  id: "workbench",
});

function WorkbenchLayout() {
  // 背景归属共同父路由，子路由切换时保留图片 DOM、加载状态与 Object URL。
  return (
    <WorkbenchBackground>
      <Outlet />
    </WorkbenchBackground>
  );
}

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
