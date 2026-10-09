import { useContext, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SplitPaneContext } from "@codexly/ui/core/split-workspace";
import { useSplitInspector } from "@codexly/ui/core/split-inspector";
import { WorkbenchInspector } from "./workbench-inspector.js";
import type { WorkbenchComposerHandle } from "./workbench-composer.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

export function WorkbenchShellInspector({
  context,
  composerRef,
  projectId,
  taskId,
  temporary,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  composerRef: RefObject<WorkbenchComposerHandle | null>;
  projectId: string;
  taskId?: string;
  temporary: boolean;
}>) {
  const pane = useContext(SplitPaneContext);
  const inspector = useSplitInspector();
  const {
    backgroundTerminals,
    client,
    closeInspector,
    expandedFileTreePaths,
    gitStatusQuery,
    inspectorTab,
    inspectorTask,
    mcpServersQuery,
    mcpServersReloadMutation,
    openProjectFileDiff,
    openFileReview,
    openProjectFile,
    projectName,
    projectOpenCapabilitiesQuery,
    projectPath,
    projectPathOpenLockRef,
    projectPathOpenMutation,
    taskAttachmentOpenMutation,
    refreshProjectGitStatus,
    runtime,
    selectedRootPath,
    selectedRootId,
    inspectorDocuments,
    openInspectorDocument,
    removeInspectorDocument,
    setFileTreeExpansion,
    setInspectorOpen,
    setInspectorTab,
    setSubagentDialogSelection,
    skillsQuery,
    subagents,
  } = context;
  // 只挂载活动窗口的右栏；沿用该窗口的运行时，避免另读一次任务历史。
  if (pane !== null && (!pane.active || inspector?.target == null)) return null;
  const content = (
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
      documents={inspectorDocuments}
      onCloseDocument={removeInspectorDocument}
      onOpenLoadedDiff={openProjectFileDiff}
      onOpenCommit={(commit, repository) => {
        openInspectorDocument({
          id: `commit:${repository ?? "root"}:${commit.sha}`,
          kind: "commit",
          commit,
          ...(repository === undefined ? {} : { repository }),
        });
      }}
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
      onReviewChanges={openFileReview}
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
      {...(runtime.store === undefined ? {} : { taskStore: runtime.store })}
      terminatingTerminalId={backgroundTerminals.terminatingTerminalId}
      {...(inspectorTask === undefined ? {} : { task: inspectorTask })}
      {...(taskId === undefined ? {} : { taskId })}
      {...(gitStatusQuery.data === undefined ? {} : { gitStatus: gitStatusQuery.data })}
    />
  );
  return pane !== null && inspector?.target != null
    ? createPortal(content, inspector.target)
    : content;
}
