import { useSplitInspectorBridge } from "@codexly/ui/core/split-inspector";
import { WorkbenchSettingsPage } from "./workbench-settings-page.js";
import { useNavigate } from "@tanstack/react-router";
import { useRef, type CSSProperties, type ReactNode } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { RuntimeUnavailable } from "../../../shared/components/core/runtime-unavailable.js";
import { ProjectSidebar } from "./project-sidebar.js";
import { TaskTimeline } from "./task-timeline.js";
import { useNewChatPendingPrompt } from "./use-new-chat-pending-prompt.js";
import { WorkbenchComposer, type WorkbenchComposerHandle } from "./workbench-composer.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { inspectorWidthLimits, sidebarWidthLimits } from "./workbench-panel-layout.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellDialogs } from "./workbench-shell-dialogs.js";
import { ActiveTaskWorkbench } from "./workbench-shell-active-task.js";
import { WorkbenchShellInspector } from "./workbench-shell-inspector.js";
import { fileDocumentId } from "./workbench-inspector-documents.js";
import { WorkbenchPetLayer } from "../../pets/components/workbench-pet-layer.js";
import { TaskBoardContainer } from "./task-board-container.js";
import { WorkbenchShellHeader } from "./workbench-shell-header.js";
import { SkillsMarketView } from "./skills-market-view.js";
import { ScheduledTasksView } from "./scheduled-tasks-view.js";

export function WorkbenchShellLayout({
  board,
  embedded = false,
  workspaceContent,
  composerDraftId,
  context,
  extensionSection,
  projectId,
  scheduled,
  taskId,
  temporary,
  todoId,
}: Readonly<{
  board: boolean;
  embedded?: boolean;
  workspaceContent?: ReactNode;
  composerDraftId?: string;
  context: ReturnType<typeof useWorkbenchShellController>;
  extensionSection?: string;
  projectId: string;
  scheduled: boolean;
  taskId?: string;
  temporary: boolean;
  todoId?: string;
}>) {
  const composerRef = useRef<WorkbenchComposerHandle>(null);
  const navigate = useNavigate();
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
    newChatSubmissionStartedAt,
    openFileDiff,
    openFileReview,
    openMessageFileReference,
    openProjectFolder,
    pendingTaskSelection,
    projectDefaultsQuery,
    projectFolderOpenAvailable,
    projectFolderOpenDisabled,
    projectName,
    projectRoots,
    projectPath,
    projectTaskState,
    projects,
    requestNotificationPermission,
    retry,
    runtime,
    selectedRootPath,
    selectedRootId,
    openInspectorDocument,
    setGlobalSettingsSection,
    setInspectorWidth,
    setSidebarWidth,
    setSelectedRootId,
    sidebarConnectionState,
    sidebarOpen,
    sidebarWidth,
    skillsQuery,
    startingSnapshot,
    taskLaunchState,
    updateDraftSettings,
    updateProjectTaskDefaults,
    workbenchShellRef,
    t,
  } = context;
  const { activePane, openSidebarDocument } = useSplitInspectorBridge(
    workbenchShellRef,
    openInspectorDocument,
  );
  const newChatSubmission = useNewChatPendingPrompt(
    `${projectId}:${todoId ?? "new"}:${String(temporary)}`,
    beginNewChatSubmission,
  );
  const extensions = extensionSection !== undefined;
  const utilityView = board || extensions || scheduled;
  return (
    <>
      <div
        className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
        data-embedded={embedded}
        hidden={context.globalSettingsSection !== null}
        inert={context.globalSettingsSection !== null}
        data-inspector-open={!embedded && !utilityView && inspectorOpen}
        data-sidebar-open={sidebarOpen}
        ref={workbenchShellRef}
        style={
          {
            "--inspector-open-width": `${String(inspectorWidth)}px`,
            "--sidebar-open-width": `${String(sidebarWidth)}px`,
          } as CSSProperties
        }
      >
        {!embedded ? (
          <>
            <ProjectSidebar
              {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
              connectionState={sidebarConnectionState}
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
              projectId={activePane?.projectId ?? projectId}
              {...(activePane !== undefined
                ? activePane.taskId === undefined
                  ? {}
                  : { taskId: activePane.taskId }
                : taskId === undefined && pendingTaskSelection?.projectId === projectId
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
          </>
        ) : null}
        {workspaceContent ?? (
          <main
            aria-label={t(
              scheduled
                ? "scheduledTasks.title"
                : extensions
                  ? "skillsMarket.title"
                  : board
                    ? "taskBoard.label"
                    : "shell.timeline",
            )}
            className="flex min-h-0 min-w-0 flex-col bg-content"
          >
            <WorkbenchShellHeader
              board={board}
              context={context}
              projectId={projectId}
              scheduled={scheduled}
              skillsMarket={extensions}
              temporary={temporary}
              {...(taskId === undefined ? {} : { taskId })}
            />
            {scheduled ? (
              <ScheduledTasksView context={context} projectId={projectId} temporary={temporary} />
            ) : extensions ? (
              <SkillsMarketView
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
            ) : board ? (
              <TaskBoardContainer projectId={projectId} />
            ) : error !== null ||
              (projectTaskState?.error ?? null) !== null ||
              modelsQuery.error !== null ||
              skillsQuery.error !== null ||
              (!temporary && projectDefaultsQuery.error !== null) ||
              (taskId === undefined && globalSettingsQuery.error !== null) ? (
              <RuntimeUnavailable onRetry={() => void retry()} />
            ) : taskId === undefined ? (
              <>
                <TaskTimeline
                  onProjectChange={handleNewTaskProjectChange}
                  projectId={projectId}
                  projects={projects}
                  pendingPrompt={newChatSubmission.pendingPrompt}
                  {...(temporary
                    ? { scopeName: t("shell.temporaryTask"), temporary: true as const }
                    : {})}
                  {...(newChatSubmissionStartedAt === undefined
                    ? {}
                    : { submissionStartedAt: newChatSubmissionStartedAt })}
                />
                <WorkbenchComposer
                  {...(composerDraftId === undefined ? {} : { composerDraftId })}
                  capabilities={capabilities}
                  client={client}
                  composerRef={composerRef}
                  followUpBehavior={globalSettings?.followUpBehavior ?? "queue"}
                  fastModeAvailable={fastModeAvailable}
                  fastModeDefault={fastModeDefault}
                  {...(todoId === undefined ? {} : { initialTodoId: todoId })}
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
                  onRequestNotificationPermission={requestNotificationPermission}
                  onDirectSubmission={newChatSubmission.onDirectSubmission}
                  onSubmissionFailed={newChatSubmission.onSubmissionFailed}
                  onSubmissionStateChange={handleNewChatSubmissionStateChange}
                  onTaskCreated={handleTaskCreated}
                  onTaskStarted={handleTaskStarted}
                  projectId={projectId}
                  projectName={projectName}
                  projectPath={projectPath}
                  projectPathOpenAvailable={projectFolderOpenAvailable}
                  projectPathOpenDisabled={projectFolderOpenDisabled}
                  projectRoots={projectRoots}
                  // 新建临时任务也必须禁用依赖 Project 根目录的命令。
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
                projectPathOpenAvailable={projectFolderOpenAvailable}
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
        )}

        {!embedded && !utilityView && inspectorOpen ? (
          <Button
            variant="ghost"
            aria-label={t("shell.closeInspector")}
            className="workbench-inspector-scrim"
            onClick={closeInspector}
            type="button"
          />
        ) : null}

        {!embedded && !utilityView && inspectorOpen ? (
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
        {workspaceContent === undefined && !utilityView && inspectorOpen ? (
          <WorkbenchShellInspector
            context={context}
            composerRef={composerRef}
            projectId={projectId}
            temporary={temporary}
            {...(taskId === undefined ? {} : { taskId })}
          />
        ) : null}
        {!embedded ? <WorkbenchPetLayer settings={globalSettings?.pet} /> : null}
        <WorkbenchShellDialogs
          context={context}
          projectId={projectId}
          {...(taskId === undefined ? {} : { taskId })}
        />
      </div>
      {context.globalSettingsSection === null ? null : (
        <WorkbenchSettingsPage context={context} projectToolsEnabled={!temporary} />
      )}
    </>
  );
}
