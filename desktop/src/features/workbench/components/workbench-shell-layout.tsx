import { PanelLeft, Pencil } from "lucide-react";
import { TerminalWorkbench } from "../../terminal/components/terminal-workbench.js";
import { Suspense, useRef, type CSSProperties } from "react";
import { Button } from "../../../shared/components/core/button.js";
import { RuntimeUnavailable } from "../../../shared/components/core/runtime-unavailable.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { TaskTimeline } from "./task-timeline.js";
import { TaskBoardContainer } from "./task-board-container.js";
import { SkillsMarketContainer } from "../../skills-market/skills-market-container.js";
import { WorkbenchComposer, type WorkbenchComposerHandle } from "./workbench-composer.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { inspectorWidthLimits, resolveInspectorVisibility, resolveQuickOpenVisibility } from "./workbench-panel-layout.js";
import { WorkbenchSidebarChrome } from "./workbench-sidebar-chrome.js";
import { ProjectQuickOpenMenu } from "./project-open-menu.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellDialogs } from "./workbench-shell-dialogs.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";
import { WorkbenchInspector } from "./workbench-inspector.js";
import { WorkbenchInspectorToggle } from "./workbench-inspector-toggle.js";
import { getWorkbenchInspectorMountKey } from "../workbench-inspector-activation.js";
import { LazyScheduledTasksContainer } from "./scheduled-tasks-lazy.js";
import { TaskInteractionContext } from "../task-interaction-context.js";
export function WorkbenchShellLayout({
  board,
  context,
  draftId,
  extensionSection,
  projectId,
  scheduledTasks,
  taskId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  board: boolean;
  draftId?: string;
  projectId: string;
  scheduledTasks: boolean;
  extensionSection?: string;
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
    navigate,
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
  const extensions = extensionSection !== undefined;
  const utilityView = board || extensions || scheduledTasks;
  const viewTitle = scheduledTasks ? t("scheduledTasks.title") : extensions ? t("skillsMarket.title") : board ? t("taskBoard.title") : title;
  const inspectorVisible = resolveInspectorVisibility(utilityView, inspectorOpen);
  const taskWriteBlocked = taskId !== undefined && runtime.writeAccess !== undefined && runtime.writeAccess !== "writable";
  return (
    <TaskInteractionContext value={taskWriteBlocked ? JSON.stringify([projectId, taskId]) : null}>
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open={inspectorVisible}
      data-sidebar-open={sidebarOpen}
      ref={workbenchShellRef}
      style={
        {
          "--inspector-open-width": `${String(inspectorWidth)}px`,
          "--sidebar-open-width": `${String(sidebarWidth)}px`,
        } as CSSProperties
      }
    >
      <ProjectSidebar
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
        onClose={closeSidebar}
        onOpenSettings={(section) => {
          setGlobalSettingsSection(section);
        }}
        onPanelShortcut={(panel) => {
          if (panel === "search") setSidebarOpen(true);
          else if (panel === "sidebar") setSidebarOpen((open) => !open);
          else if (!utilityView) setInspectorOpen((open) => !open);
        }}
        projectId={projectId}
        {...(taskId === undefined && pendingTaskSelection?.projectId === projectId
          ? { taskId: pendingTaskSelection.taskId }
          : taskId === undefined
            ? {}
            : { taskId })}
      />
      <WorkbenchSidebarChrome
        closeLabel={t("shell.closeSidebar")}
        onClose={closeSidebar}
        onWidthChange={setSidebarWidth}
        open={sidebarOpen}
        resizeLabel={t("shell.resizeSidebar")}
        shellRef={workbenchShellRef}
        width={sidebarWidth}
      />
      <TerminalWorkbench label={t("shell.timeline")} enabled={!utilityView && !temporary && projectRoots.length > 0} projectId={projectId} rootId={selectedRootId} taskId={taskId}>
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
              aria-label={viewTitle}
              className="min-w-0 text-body-small font-semibold text-foreground"
            >
              {taskId === undefined ? (
                <span className="block truncate">{viewTitle}</span>
              ) : (
                <Button
                  variant="ghost"
                  aria-label={t("shell.renameTask", { title })}
                  className="group flex max-w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-control-hover focus-visible:shadow-focus"
                  id="workbench-task-title-rename"
                  disabled={taskWriteBlocked}
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
                onToggle={() => {
                  setInspectorOpen((open) => !open);
                }}
              />
            )}
          </div>
        </header>
        {scheduledTasks ? (
          <Suspense fallback={<div aria-busy="true" style={{ flex: 1 }} />}>
            <LazyScheduledTasksContainer context={context} projectId={projectId} temporary={temporary} />
          </Suspense>
        ) : extensions ? (
          <SkillsMarketContainer
            section={extensionSection}
            onSectionChange={(nextSection) => {
              void navigate(
                temporary
                  ? { params: { section: nextSection }, to: "/temporary/extensions/$section" }
                  : { params: { projectId, section: nextSection }, to: "/p/$projectId/extensions/$section" },
              );
            }}
            {...(temporary ? {} : { projectId })}
            {...(selectedRootPath === undefined ? {} : { rootPath: selectedRootPath })}
          />
        ) : error !== null ||
        (projectTaskState?.error ?? null) !== null ||
        modelsQuery.error !== null ||
        skillsQuery.error !== null ||
        (!temporary && projectDefaultsQuery.error !== null) ||
        (taskId === undefined && globalSettingsQuery.error !== null) ? (
          <RuntimeUnavailable onRetry={() => void retry()} />
        ) : board ? (
          <TaskBoardContainer projectId={projectId} />
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
              key={draftId === undefined ? "new-task" : `draft:${draftId}`}
              capabilities={capabilities}
              client={client}
              composerRef={composerRef}
              followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
              {...(draftId === undefined ? {} : { initialProjectDraftId: draftId })}
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
              onDirectSubmission={beginNewChatSubmission}
              onSubmissionStateChange={handleNewChatSubmissionStateChange}
              onTaskCreated={handleTaskCreated}
              onTaskStarted={handleTaskStarted}
              projectId={projectId}
              projectName={projectName}
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
            onProjectTaskDefaultsChange={updateProjectTaskDefaults}
            onOpenProjectPath={openProjectFolder}
            onProjectRootChange={setSelectedRootId}
            onTaskStarted={handleTaskStarted}
            projectId={projectId}
            projectName={projectName}
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
      </TerminalWorkbench>
      {inspectorVisible ? (
        <Button
          variant="ghost"
          aria-label={t("shell.closeInspector")}
          className="workbench-inspector-scrim"
          onClick={closeInspector}
          type="button"
        />
      ) : null}
      {inspectorVisible ? (
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
      {inspectorVisible ? (
        <WorkbenchInspector
          backgroundTerminals={backgroundTerminals.terminals}
          contextOnly={temporary}
          expandedFileTreePaths={expandedFileTreePaths}
          gitStatusError={gitStatusQuery.error}
          gitStatusPending={gitStatusQuery.isPending}
          gitStatusRefreshing={gitStatusQuery.isFetching}
          gitClient={client}
          mcpServers={mcpServersQuery.data?.data ?? []}
          mcpServersRetryAvailable={taskId !== undefined}
          mcpServersRefreshing={mcpServersQuery.isFetching && !mcpServersQuery.isPending}
          mcpServersRetrying={mcpServersReloadMutation.isPending}
          key={getWorkbenchInspectorMountKey({ projectId, taskId })}
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
          onReviewFileChanges={openFileReview}
          onCommitChanges={() => setInspectorTab("changes")}
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
          {...(runtime.store === undefined ? {} : { taskStore: runtime.store })}
          {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
        />
      ) : null}
      <WorkbenchShellDialogs
        context={context}
        projectId={projectId}
        {...(taskId === undefined ? {} : { taskId })}
      />
    </div>
    </TaskInteractionContext>
  );
}
