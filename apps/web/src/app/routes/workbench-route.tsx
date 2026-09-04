import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { createRoute, useRouterState } from "@tanstack/react-router";
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
  const routeParams = useRouterState({
    select: (state) => {
      const params = state.matches.at(-1)?.params;
      return {
        board: state.location.pathname.endsWith("/board"),
        skillsMarket: state.location.pathname.endsWith("/skills"),
        projectId: params !== undefined && "projectId" in params ? params.projectId : undefined,
        taskId: params !== undefined && "taskId" in params ? params.taskId : undefined,
        todoId: params !== undefined && "todoId" in params ? params.todoId : undefined,
      };
    },
  });
  const projectId = routeParams.projectId ?? TEMPORARY_TASK_SCOPE_ID;
  const temporary = routeParams.projectId === undefined;

  // Shell 与背景都归属共同父路由，切换 Task 或新建任务时保留侧栏和面板布局。
  return (
    <WorkbenchBackground>
      <WorkbenchRoute
        board={routeParams.board}
        skillsMarket={routeParams.skillsMarket}
        {...(routeParams.todoId === undefined ? {} : { todoId: routeParams.todoId })}
        projectId={projectId}
        temporary={temporary}
        {...(routeParams.taskId === undefined ? {} : { taskId: routeParams.taskId })}
      />
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
