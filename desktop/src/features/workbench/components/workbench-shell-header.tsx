import { PanelLeft, Pencil } from "lucide-react";

import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { resolveQuickOpenVisibility } from "./workbench-panel-layout.js";
import { ProjectQuickOpenMenu } from "./project-open-menu.js";
import { WorkbenchInspectorToggle } from "./workbench-inspector-toggle.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

export function WorkbenchShellHeader({
  context,
  taskId,
  taskWriteBlocked,
  temporary,
  utilityView,
  viewTitle,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  taskId?: string;
  taskWriteBlocked: boolean;
  temporary: boolean;
  utilityView: boolean;
  viewTitle: string;
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

  return (
    <header className="flex h-workbench-header shrink-0 items-center justify-between gap-3 bg-content px-2.5 shadow-toolbar sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip key={sidebarOpen ? "sidebar-open" : "sidebar-closed"}>
          <TooltipTrigger asChild>
            <Button
              aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
              id="workbench-sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PanelLeft className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
          </TooltipContent>
        </Tooltip>
        <h1
          aria-label={viewTitle}
          className="min-w-0 text-body-small font-semibold text-foreground"
        >
          {taskId === undefined ? (
            <span className="block truncate">{viewTitle}</span>
          ) : (
            <Button
              aria-label={t("shell.renameTask", { title })}
              className="group flex max-w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-control-hover focus-visible:shadow-focus"
              disabled={taskWriteBlocked}
              id="workbench-task-title-rename"
              onClick={() => setTaskRenameOpen(true)}
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
      <div className="flex shrink-0 items-center gap-1">
        {resolveQuickOpenVisibility(utilityView, temporary) ? (
          <ProjectQuickOpenMenu
            apps={projectOpenCapabilitiesQuery.data?.apps ?? []}
            className="hidden min-workbench:flex"
            {...(globalSettings === undefined
              ? {}
              : { defaultOpenAppId: globalSettings.defaultOpenAppId })}
            hidden={false}
            isDetecting={projectOpenCapabilitiesQuery.isPending}
            isPending={projectPathOpenMutation.isPending}
            onSelect={(appId) => {
              projectPathOpenMutation.reset();
              void projectPathOpenLockRef.current
                .run(() => projectPathOpenMutation.mutateAsync({ appId, path: undefined }))
                .catch(() => undefined);
            }}
          />
        ) : null}
        {utilityView ? null : (
          <WorkbenchInspectorToggle
            collapseLabel={t("shell.collapseInspector")}
            expandLabel={t("shell.expandInspector")}
            inspectorOpen={inspectorOpen}
            onToggle={() => setInspectorOpen((open) => !open)}
          />
        )}
      </div>
    </header>
  );
}
