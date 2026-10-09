import { useSplitInspectorBridge } from "@codexly/ui/core/split-inspector";
import type { ReactNode } from "react";
import { TerminalWorkbench } from "../../terminal/components/terminal-workbench.js";
import { lazy, Suspense, useRef, useState, type CSSProperties } from "react";
import { Button } from "../../../shared/components/core/button.js";
import { RuntimeUnavailable } from "../../../shared/components/core/runtime-unavailable.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { TaskTimeline } from "./task-timeline.js";
import type { PendingPrompt } from "./pending-prompt.js";
import { TaskBoardContainer } from "./task-board-container.js";
import { WorkbenchComposer, type WorkbenchComposerHandle } from "./workbench-composer.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { inspectorWidthLimits, resolveInspectorVisibility } from "./workbench-panel-layout.js";
import { WorkbenchSidebarChrome } from "./workbench-sidebar-chrome.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellDialogs } from "./workbench-shell-dialogs.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";
import { WorkbenchShellInspector } from "./workbench-shell-inspector.js";
import { fileDocumentId } from "./workbench-inspector-documents.js";
import { WorkbenchShellHeader } from "./workbench-shell-header.js";
import { LazyScheduledTasksContainer } from "./scheduled-tasks-lazy.js";
import { TaskInteractionContext } from "../task-interaction-context.js";
const LazySkillsMarketContainer = lazy(() =>
  import("../../skills-market/skills-market-container.js").then((module) => ({
    default: module.SkillsMarketContainer,
  })),
);
export function WorkbenchShellLayout({
  board,
  embedded = false,
  workspaceContent,
  composerDraftId,
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
  embedded?: boolean;
  workspaceContent?: ReactNode;
  composerDraftId?: string;
  draftId?: string;
  projectId: string;
  scheduledTasks: boolean;
  extensionSection?: string;
  taskId?: string;
  temporary: boolean;
}>) {
  const composerRef = useRef<WorkbenchComposerHandle>(null);
  const [newChatPromptState, setNewChatPromptState] = useState<{
    prompt: PendingPrompt | undefined;
    scope: string;
  }>();
  const newChatScope = `${projectId}:${draftId ?? "new"}:${String(temporary)}`;
  const newChatPrompt = newChatPromptState?.scope === newChatScope
    ? newChatPromptState.prompt
    : undefined;
  const {
    appInfoQuery,
    beginNewChatSubmission,
    capabilities,
    client,
    closeInspector,
    closeSidebar,
    draftSettings,
    error,
    fastModeAvailable,
    fastModeDefault,
    gitStatusQuery,
    globalSettings,
    globalSettingsQuery,
    handleNewChatSubmissionStateChange,
    handleNewTaskProjectChange,
    handleTaskCreated,
    handleTaskStarted,
    inspectorOpen,
    inspectorMaximumWidth,
    inspectorWidth,
    models,
    modelsQuery,
    navigate,
    newChatSubmissionStartedAt,
    openFileDiff,
    openFileReview,
    openMessageFileReference,
    openProjectFolder,
    pendingTaskSelection,
    projectDefaultsQuery,
    projectFolderOpenDisabled,
    projectName,
    projectRoots,
    projectPath,
    projectTaskState,
    projects,
    retry,
    runtime,
    selectedRootPath,
    selectedRootId,
    openInspectorDocument,
    setGlobalSettingsSection,
    setInspectorOpen,
    setInspectorWidth,
    setSidebarOpen,
    setSidebarWidth,
    setSelectedRootId,
    sidebarOpen,
    sidebarWidth,
    skillsQuery,
    startingSnapshot,
    taskLaunchState,
    title,
    updateDraftSettings,
    updateProjectTaskDefaults,
    workbenchShellRef,
    t,
  } = context;
  const { activePane, openSidebarDocument } = useSplitInspectorBridge(workbenchShellRef, openInspectorDocument);
  const extensions = extensionSection !== undefined;
  const utilityView = board || extensions || scheduledTasks;
  const viewTitle = scheduledTasks
    ? t("scheduledTasks.title")
    : extensions
      ? t("skillsMarket.title")
      : board
        ? t("taskBoard.title")
        : title;
  const inspectorVisible = resolveInspectorVisibility(utilityView, inspectorOpen);
  const taskWriteBlocked =
    workspaceContent === undefined && taskId !== undefined && runtime.writeAccess !== undefined && runtime.writeAccess !== "writable";
  return (
    <TaskInteractionContext value={taskWriteBlocked ? JSON.stringify([projectId, taskId]) : null}>
      <div
        className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
        data-embedded={embedded}
        data-inspector-open={!embedded && inspectorVisible}
        data-sidebar-open={sidebarOpen}
        ref={workbenchShellRef}
        style={
          {
            "--inspector-open-width": `${String(inspectorWidth)}px`,
            "--sidebar-open-width": `${String(sidebarWidth)}px`,
          } as CSSProperties
        }
      >
        {!embedded ? <>
        <ProjectSidebar
          {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
          onClose={closeSidebar}
          onOpenFile={(file, kind) => {
            openSidebarDocument({
              id: fileDocumentId(kind, `${file.projectId}:${file.rootPath}:${file.path}`),
              kind,
              projectId: file.projectId,
              rootPath: file.rootPath,
              reference: { lineNumber: null, path: file.path },
            });
          }}
          onOpenSettings={(section) => {
            setGlobalSettingsSection(section);
          }}
          onPanelShortcut={(panel) => {
            if (panel === "search") setSidebarOpen(true);
            else if (panel === "sidebar") setSidebarOpen((open) => !open);
            else if (!utilityView) setInspectorOpen((open) => !open);
          }}
          projectId={activePane?.projectId ?? projectId}
          {...(activePane !== undefined ? (activePane.taskId === undefined ? {} : { taskId: activePane.taskId }) : taskId === undefined && pendingTaskSelection?.projectId === projectId
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
        </> : null}
        {workspaceContent ?? (
        <TerminalWorkbench
          label={t("shell.timeline")}
          enabled={!utilityView && !temporary && projectRoots.length > 0}
          projectId={projectId}
          rootId={selectedRootId}
          taskId={taskId}
        >
          <WorkbenchShellHeader
            context={context}
            {...(taskId === undefined ? {} : { taskId })}
            taskWriteBlocked={taskWriteBlocked}
            temporary={temporary}
            utilityView={utilityView}
            viewTitle={viewTitle}
          />
          {scheduledTasks ? (
            <Suspense fallback={<div aria-busy="true" style={{ flex: 1 }} />}>
              <LazyScheduledTasksContainer
                context={context}
                projectId={projectId}
                temporary={temporary}
              />
            </Suspense>
          ) : extensions ? (
            <Suspense fallback={<div aria-busy="true" style={{ flex: 1 }} />}>
              <LazySkillsMarketContainer
                section={extensionSection}
                onSectionChange={(nextSection) => {
                  void navigate(
                    temporary
                      ? { params: { section: nextSection }, to: "/temporary/extensions/$section" }
                      : {
                          params: { projectId, section: nextSection },
                          to: "/p/$projectId/extensions/$section",
                        },
                  );
                }}
                {...(temporary ? {} : { projectId })}
                {...(selectedRootPath === undefined ? {} : { rootPath: selectedRootPath })}
              />
            </Suspense>
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
              <TaskTimeline
                onProjectChange={handleNewTaskProjectChange}
                projectId={projectId}
                projects={projects}
                {...(temporary ? { scopeName: t("shell.temporaryTask"), temporary: true as const } : {})}
                {...(newChatPrompt === undefined ? {} : { pendingPrompt: newChatPrompt })}
                {...(newChatSubmissionStartedAt === undefined
                  ? {}
                  : { submissionStartedAt: newChatSubmissionStartedAt })}
              />
              <WorkbenchComposer
                {...(composerDraftId === undefined ? {} : { composerDraftId })}
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
                onFastModeChange={(enabled, settings) =>
                  updateProjectTaskDefaults(settings, enabled)
                }
                onOpenProjectPath={openProjectFolder}
                onProjectRootChange={setSelectedRootId}
                onDirectSubmission={(prompt) => {
                  beginNewChatSubmission();
                  setNewChatPromptState({ prompt, scope: newChatScope });
                }}
                onSubmissionFailed={() => setNewChatPromptState(undefined)}
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
        )}

        {!embedded && inspectorVisible ? (
          <Button
            variant="ghost"
            aria-label={t("shell.closeInspector")}
            className="workbench-inspector-scrim"
            onClick={closeInspector}
            type="button"
          />
        ) : null}
        {!embedded && inspectorVisible ? (
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
        {workspaceContent === undefined && inspectorVisible ? (
          <WorkbenchShellInspector context={context} composerRef={composerRef}
            projectId={projectId} temporary={temporary}
            {...(taskId === undefined ? {} : { taskId })} />
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
