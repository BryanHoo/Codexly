import { PanelLeft, PanelRight, Pencil } from "lucide-react";
import { useRef, type CSSProperties } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { RuntimeUnavailable } from "../../../shared/components/core/runtime-unavailable.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { TaskTimeline } from "./task-timeline.js";
import { WorkbenchComposer, type WorkbenchComposerHandle } from "./workbench-composer.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { inspectorWidthLimits, sidebarWidthLimits } from "./workbench-panel-layout.js";
import { ProjectQuickOpenMenu } from "./project-open-menu.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellDialogs } from "./workbench-shell-dialogs.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";
import { WorkbenchInspector } from "./workbench-inspector.js";

type WorkbenchShellStyle = CSSProperties &
  Readonly<{ "--inspector-open-width": string; "--sidebar-open-width": string }>;

export function WorkbenchShellLayout({
  context,
  projectId,
  taskId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  taskId?: string;
  temporary: boolean;
}>) {
  const composerRef = useRef<WorkbenchComposerHandle>(null);
  const {
    appInfoQuery,
    backgroundTerminals,
    beginNewChatSubmission,
    capabilities,
    client,
    closeInspector,
    closeSidebar,
    draftSettings,
    error,
    fastModeAvailable,
    fastModeDefault,
    expandedFileTreePaths,
    gitStatusQuery,
    globalSettings,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    handleNewTaskProjectChange,
    handleTaskCreated,
    handleTaskStarted,
    inspectorOpen,
    inspectorMaximumWidth,
    inspectorTab,
    inspectorTask,
    inspectorWidth,
    mcpServersQuery,
    mcpServersReloadMutation,
    models,
    modelsQuery,
    newChatSubmissionStartedAt,
    openFileDiff,
    openProjectFileDiff,
    openFileReview,
    openMessageFileReference,
    openProjectFile,
    openProjectFolder,
    pendingTaskSelection,
    projectDefaultsQuery,
    projectFolderOpenDisabled,
    projectName,
    projectRoots,
    projectOpenCapabilitiesQuery,
    projectPath,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    taskAttachmentOpenMutation,
    projectTaskState,
    projects,
    refreshProjectGitStatus,
    requestNotificationPermission,
    retry,
    runtime,
    selectedRootPath,
    selectedRootId,
    selectedInspectorFile,
    setFileTreeExpansion,
    setGlobalSettingsSection,
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    setInspectorFileSelection,
    setSidebarOpen,
    setSidebarWidth,
    setSelectedRootId,
    setSubagentDialogSelection,
    setTaskRenameOpen,
    sidebarConnectionState,
    sidebarOpen,
    sidebarWidth,
    skillsQuery,
    startingSnapshot,
    subagents,
    taskLaunchState,
    title,
    updateDraftSettings,
    updateProjectTaskDefaults,
    workbenchShellRef,
    t,
  } = context;
  return (
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open={inspectorOpen}
      data-sidebar-open={sidebarOpen}
      ref={workbenchShellRef}
      style={
        {
          "--inspector-open-width": `${String(inspectorWidth)}px`,
          "--sidebar-open-width": `${String(sidebarWidth)}px`,
        } as WorkbenchShellStyle
      }
    >
      <ProjectSidebar
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
        connectionState={sidebarConnectionState}
        onClose={closeSidebar}
        onOpenSettings={(section) => {
          setGlobalSettingsSection(section);
        }}
        projectId={projectId}
        {...(taskId === undefined && pendingTaskSelection?.projectId === projectId
          ? { taskId: pendingTaskSelection.taskId }
          : taskId === undefined
            ? {}
            : { taskId })}
      />
      {sidebarOpen ? (
        <Button
          variant="ghost"
          aria-label={t("shell.closeSidebar")}
          className="workbench-sidebar-scrim"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}
      {sidebarOpen ? (
        <WorkbenchPanelResizer
          direction={1}
          label={t("shell.resizeSidebar")}
          maximumWidth={sidebarWidthLimits.maximum}
          minimumWidth={sidebarWidthLimits.minimum}
          onResize={(width) => {
            workbenchShellRef.current?.style.setProperty(
              "--sidebar-open-width",
              `${String(width)}px`,
            );
          }}
          onResizeEnd={(width) => {
            workbenchShellRef.current?.removeAttribute("data-resizing-panel");
            setSidebarWidth(width);
          }}
          onResizeStart={() => {
            workbenchShellRef.current?.setAttribute("data-resizing-panel", "sidebar");
          }}
          panel="sidebar"
          width={sidebarWidth}
        />
      ) : null}
      <main aria-label={t("shell.timeline")} className="flex min-h-0 min-w-0 flex-col bg-content">
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
                  <PanelLeft className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")}
              </TooltipContent>
            </Tooltip>
            <h1
              aria-label={title}
              className="min-w-0 text-body-small font-semibold text-foreground"
            >
              {taskId === undefined ? (
                <span className="block truncate">{title}</span>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={t("shell.renameTask", { title })}
                  className="group flex max-w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-control-hover focus-visible:shadow-focus"
                  id="workbench-task-title-rename"
                  onClick={() => {
                    setTaskRenameOpen(true);
                  }}
                  type="button"
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
            <ProjectQuickOpenMenu
              apps={projectOpenCapabilitiesQuery.data?.apps ?? []}
              className="hidden min-workbench:flex"
              {...(globalSettings === undefined
                ? {}
                : { defaultOpenAppId: globalSettings.defaultOpenAppId })}
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
                  <PanelRight className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {inspectorOpen ? t("shell.collapseInspector") : t("shell.expandInspector")}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>
        {error !== null ||
        (projectTaskState?.error ?? null) !== null ||
        modelsQuery.error !== null ||
        skillsQuery.error !== null ||
        (!temporary && projectDefaultsQuery.error !== null) ||
        (taskId === undefined && globalSettingsQuery.error !== null) ? (
          <RuntimeUnavailable onRetry={() => void retry()} />
        ) : taskId === undefined ? (
          <>
            {temporary ? (
              <TaskTimeline
                projectId={projectId}
                scopeName={t("shell.temporaryTask")}
                temporary
                {...(newChatSubmissionStartedAt === undefined
                  ? {}
                  : { submissionStartedAt: newChatSubmissionStartedAt })}
              />
            ) : (
              <TaskTimeline
                onProjectChange={handleNewTaskProjectChange}
                projectId={projectId}
                projects={projects}
                {...(newChatSubmissionStartedAt === undefined
                  ? {}
                  : { submissionStartedAt: newChatSubmissionStartedAt })}
              />
            )}
            <WorkbenchComposer
              capabilities={capabilities}
              client={client}
              composerRef={composerRef}
              followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
              fastModeAvailable={fastModeAvailable}
              fastModeDefault={fastModeDefault}
              models={models}
              modelsError={null}
              modelsPending={
                modelsQuery.isPending ||
                (!temporary && projectDefaultsQuery.isPending) ||
                globalSettingsQuery.isPending
              }
              onSettingsChange={updateDraftSettings}
              onFastModeChange={(enabled, settings) => updateProjectTaskDefaults(settings, enabled)}
              onOpenProjectPath={openProjectFolder}
              onProjectRootChange={setSelectedRootId}
              onRequestNotificationPermission={requestNotificationPermission}
              onDirectSubmission={beginNewChatSubmission}
              onSubmissionStateChange={handleNewChatSubmissionStateChange}
              onTaskCreated={handleTaskCreated}
              onTaskStarted={handleTaskStarted}
              projectId={projectId}
              projectPath={projectPath}
              projectPathOpenDisabled={projectFolderOpenDisabled}
              projectRoots={projectRoots}
              projectToolsEnabled={!temporary}
              selectedProjectRootId={selectedRootId ?? ""}
              {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
              settings={draftSettings}
              skills={skillsQuery.data?.data ?? []}
            />
          </>
        ) : (
          <ActiveTaskWorkbench
            capabilities={capabilities}
            client={client}
            composerRef={composerRef}
            fallbackSettings={draftSettings}
            followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
            fastModeAvailable={fastModeAvailable}
            fastModeDefault={fastModeDefault}
            models={models}
            modelsError={modelsQuery.error}
            modelsPending={modelsQuery.isPending}
            onRequestNotificationPermission={requestNotificationPermission}
            onProjectTaskDefaultsChange={updateProjectTaskDefaults}
            onOpenProjectPath={openProjectFolder}
            onProjectRootChange={setSelectedRootId}
            onTaskStarted={handleTaskStarted}
            projectId={projectId}
            projectPath={projectPath}
            projectPathOpenDisabled={projectFolderOpenDisabled}
            projectRoots={projectRoots}
            projectToolsEnabled={!temporary}
            selectedProjectRootId={selectedRootId ?? ""}
            {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
            runtime={runtime}
            skills={skillsQuery.data?.data ?? []}
            startingSnapshot={startingSnapshot}
            startingPrompt={taskLaunchState}
            taskId={taskId}
            onOpenFileDiff={openFileDiff}
            onOpenSourceFile={openMessageFileReference}
            onReviewFileChanges={openFileReview}
          />
        )}
      </main>
      {inspectorOpen ? (
        <Button
          variant="ghost"
          aria-label={t("shell.closeInspector")}
          className="workbench-inspector-scrim"
          onClick={closeInspector}
          type="button"
        />
      ) : null}

      {inspectorOpen ? (
        <WorkbenchPanelResizer
          direction={-1}
          label={t("shell.resizeInspector")}
          maximumWidth={inspectorMaximumWidth}
          minimumWidth={inspectorWidthLimits.minimum}
          onResize={(width) => {
            workbenchShellRef.current?.style.setProperty(
              "--inspector-open-width",
              `${String(width)}px`,
            );
          }}
          onResizeEnd={(width) => {
            workbenchShellRef.current?.removeAttribute("data-resizing-panel");
            setInspectorWidth(width);
          }}
          onResizeStart={() => {
            workbenchShellRef.current?.setAttribute("data-resizing-panel", "inspector");
          }}
          panel="inspector"
          width={inspectorWidth}
        />
      ) : null}
      {inspectorOpen ? (
        <WorkbenchInspector
          backgroundTerminals={backgroundTerminals.terminals}
          backgroundTerminalsError={backgroundTerminals.error}
          backgroundTerminalsPending={backgroundTerminals.isPending}
          contextOnly={temporary}
          expandedFileTreePaths={expandedFileTreePaths}
          gitStatusError={gitStatusQuery.error}
          gitStatusDetails={context.gitStatusDetailsQuery.data}
          gitStatusDetailsError={context.gitStatusDetailsQuery.error}
          gitStatusDetailsPending={context.gitStatusDetailsQuery.isFetching}
          gitStatusPending={gitStatusQuery.isPending}
          gitStatusRefreshing={gitStatusQuery.isFetching}
          gitClient={client}
          mcpServers={mcpServersQuery.data?.data ?? []}
          mcpServersRetryAvailable={taskId !== undefined}
          mcpServersRefreshing={mcpServersQuery.isFetching && !mcpServersQuery.isPending}
          mcpServersRetrying={mcpServersReloadMutation.isPending}
          key={`${projectId}:${taskId ?? "draft"}`}
          onClose={closeInspector}
          onCloseFile={() => {
            setInspectorFileSelection(null);
          }}
          fileSelection={selectedInspectorFile}
          onFileTreeExpandedChange={(nextExpandedPaths) => {
            setFileTreeExpansion({
              paths: new Set(nextExpandedPaths),
              scope: `${projectId}:${selectedRootPath ?? "temporary"}`,
            });
          }}
          onClearGoal={() =>
            taskId === undefined
              ? Promise.resolve()
              : client.clearTaskGoal(projectId, taskId).then(() => undefined)
          }
          onGoalStatusChange={(status) =>
            taskId === undefined
              ? Promise.resolve()
              : client.updateTaskGoal(projectId, taskId, { status }).then(() => undefined)
          }
          onReloadMcpServers={() => {
            mcpServersReloadMutation.mutate();
          }}
          onOpenFileDiff={openProjectFileDiff}
          onOpenProjectPath={(appId, path) => {
            projectPathOpenMutation.reset();
            void projectPathOpenLockRef.current
              .run(() => projectPathOpenMutation.mutateAsync({ appId, path }))
              .catch(() => undefined);
          }}
          onOpenProjectFile={openProjectFile}
          onOpenTaskAttachment={(attachmentId) => {
            if (taskId !== undefined) {
              taskAttachmentOpenMutation.mutate({ attachmentId, taskId });
            }
          }}
          onReferenceProjectPath={(entry) => {
            composerRef.current?.referenceProjectPath(entry);
          }}
          onRefreshGitStatus={() => {
            if (selectedRootPath !== undefined) {
              void refreshProjectGitStatus(projectId, selectedRootPath);
            }
          }}
          onRefreshProject={() =>
            selectedRootPath === undefined
              ? Promise.resolve()
              : refreshProjectGitStatus(projectId, selectedRootPath)
          }
          onCommitChanges={() => {
            setInspectorTab("changes");
            setInspectorOpen(true);
          }}
          onTerminateBackgroundTerminal={backgroundTerminals.terminateTerminal}
          onTabChange={setInspectorTab}
          onOpenSubagent={(selection) => {
            if (taskId !== undefined) {
              setSubagentDialogSelection({ parentTaskId: taskId, projectId, selection });
            }
          }}
          projectName={projectName}
          projectId={projectId}
          projectOpenApps={projectOpenCapabilitiesQuery.data?.apps ?? []}
          projectOpenPending={projectPathOpenMutation.isPending}
          projectPath={projectPath}
          projectRootId={selectedRootId ?? ""}
          {...(selectedRootPath === undefined ? {} : { sourceRootPath: selectedRootPath })}
          skills={skillsQuery.data?.data ?? []}
          subagents={subagents}
          tab={inspectorTab}
          terminatingTerminalId={backgroundTerminals.terminatingTerminalId}
          {...(inspectorTask === undefined ? {} : { task: inspectorTask })}
          {...(taskId === undefined ? {} : { taskId })}
          {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
        />
      ) : null}
      <WorkbenchShellDialogs
        context={context}
        projectId={projectId}
        projectToolsEnabled={!temporary}
        {...(taskId === undefined ? {} : { taskId })}
      />
    </div>
  );
}
