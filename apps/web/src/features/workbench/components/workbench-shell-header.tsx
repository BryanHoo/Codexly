import { PanelLeft, PanelRight, Pencil } from "lucide-react";

import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { ProjectQuickOpenMenu } from "./project-open-menu.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

export function WorkbenchShellHeader({
  board,
  context,
  scheduled,
  skillsMarket,
  taskId,
  temporary,
}: Readonly<{
  board: boolean;
  context: ReturnType<typeof useWorkbenchShellController>;
  scheduled: boolean;
  skillsMarket: boolean;
  taskId?: string;
  temporary: boolean;
}>) {
  const {
    globalSettings,
    inspectorOpen,
    projectOpenCapabilitiesQuery,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    setInspectorOpen,
    setSidebarOpen,
    setTaskRenameOpen,
    sidebarOpen,
    t,
    title,
  } = context;
  const utilityView = board || skillsMarket || scheduled;
  const heading = scheduled
    ? t("scheduledTasks.title")
    : skillsMarket
      ? t("skillsMarket.title")
      : board
        ? t("taskBoard.title")
        : title;
  return (
    <header className="flex h-workbench-header shrink-0 items-center justify-between gap-3 bg-content px-2.5 shadow-toolbar sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip key={sidebarOpen ? "sidebar-open" : "sidebar-closed"}>
          <TooltipTrigger asChild>
            <Button
              aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
              id="workbench-sidebar-toggle"
              onClick={() => {
                setSidebarOpen((open) => !open);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PanelLeft aria-hidden="true" className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
          </TooltipContent>
        </Tooltip>
        <h1 aria-label={heading} className="min-w-0 text-body-small font-semibold text-foreground">
          {taskId === undefined || utilityView ? (
            <span className="block truncate">{heading}</span>
          ) : (
            <Button
              aria-label={t("shell.renameTask", { title })}
              className="group flex max-w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-control-hover focus-visible:shadow-focus"
              id="workbench-task-title-rename"
              onClick={() => {
                setTaskRenameOpen(true);
              }}
              type="button"
              variant="ghost"
            >
              <span className="truncate">{title}</span>
              <Pencil
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              />
            </Button>
          )}
        </h1>
      </div>
      {utilityView ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <ProjectQuickOpenMenu
            apps={projectOpenCapabilitiesQuery.data?.apps ?? []}
            className="hidden min-workbench:flex"
            {...(globalSettings === undefined
              ? {}
              : { defaultOpenAppId: globalSettings.defaultOpenAppId })}
            hidden={temporary}
            isDetecting={projectOpenCapabilitiesQuery.isPending}
            isPending={projectPathOpenMutation.isPending}
            onSelect={(appId) => {
              projectPathOpenMutation.reset();
              void projectPathOpenLockRef.current
                .run(() => projectPathOpenMutation.mutateAsync({ appId, path: undefined }))
                .catch(() => undefined);
            }}
          />
          <Tooltip key={inspectorOpen ? "inspector-open" : "inspector-closed"}>
            <TooltipTrigger asChild>
              <Button
                aria-label={
                  inspectorOpen ? t("shell.collapseInspector") : t("shell.expandInspector")
                }
                id="workbench-inspector-toggle"
                onClick={() => {
                  setInspectorOpen((open) => !open);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <PanelRight aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {inspectorOpen ? t("shell.collapseInspector") : t("shell.expandInspector")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  );
}
