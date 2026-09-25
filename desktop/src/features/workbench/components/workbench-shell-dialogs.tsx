import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { lazy, Suspense } from "react";
import { ProjectSourceDialog } from "./project-source-dialog.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

// 审核工作区仅在打开弹窗时加载，项目文件统计不承担其首屏解析开销。
const LazyFileReviewDialog = lazy(async () => {
  const module = await import("../../diff/file-review-dialog.js");
  return { default: module.FileReviewDialog };
});

export function WorkbenchShellDialogs({
  context,
  projectId,
  taskId,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectId: string;
  taskId?: string;
}>) {
  const {
    client,
    closeTaskRenameDialog,
    loadProjectFileDiff,
    projectRuntime,
    renameActiveTask,
    renameMutation,
    selectedFileReview,
    selectedProjectFileDialog,
    selectedRootPath,
    selectedSubagent,
    setFileReviewSelection,
    setProjectFileDialogSelection,
    setSubagentDialogSelection,
    taskRenameOpen,
    title,
  } = context;
  return (
    <>
      {selectedProjectFileDialog?.kind === "diff" ? (
        <FileDiffDialog
          change={selectedProjectFileDialog.change}
          onClose={() => {
            setProjectFileDialogSelection(null);
          }}
        />
      ) : selectedProjectFileDialog === null ? null : (
        <ProjectSourceDialog
          client={client}
          {...(selectedProjectFileDialog.change === undefined
            ? {}
            : {
                change: selectedProjectFileDialog.change,
                loadDiff: loadProjectFileDiff,
              })}
          onClose={() => {
            setProjectFileDialogSelection(null);
          }}
          previewKind={selectedProjectFileDialog.kind}
          projectId={projectId}
          reference={selectedProjectFileDialog.reference}
          {...(selectedRootPath === undefined ? {} : { rootPath: selectedRootPath })}
        />
      )}
      {selectedFileReview === null ? null : (
        <Suspense fallback={null}>
          <LazyFileReviewDialog
            changes={selectedFileReview}
            loadDiff={loadProjectFileDiff}
            onClose={() => {
              setFileReviewSelection(null);
            }}
          />
        </Suspense>
      )}
      <SubagentOutputDialog
        onClose={() => {
          setSubagentDialogSelection(null);
        }}
        projectId={projectId}
        projectRuntime={projectRuntime}
        selection={selectedSubagent}
      />
      {taskRenameOpen && taskId !== undefined ? (
        <TaskRenameDialog
          initialTitle={title}
          isPending={renameMutation.isPending}
          key={`${projectId}:${taskId}`}
          onClose={closeTaskRenameDialog}
          onRename={(nextTitle) => void renameActiveTask(nextTitle)}
        />
      ) : null}
    </>
  );
}
