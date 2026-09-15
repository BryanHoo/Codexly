import { FileDiffDialog } from "../../diff/file-diff-dialog.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import { ProjectSourceDialog } from "./project-source-dialog.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

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
    openProjectFileDiff,
    projectRuntime,
    renameActiveTask,
    renameMutation,
    selectedFileReview,
    selectedProjectFileDiffDialog,
    selectedProjectFileDialog,
    selectedRootPath,
    selectedSubagent,
    setFileReviewSelection,
    setProjectFileDiffDialogSelection,
    setProjectFileDialogSelection,
    setSubagentDialogSelection,
    taskRenameOpen,
    title,
  } = context;
  const previewChange = selectedProjectFileDialog?.change;
  const openPreviewDiff =
    previewChange === undefined
      ? undefined
      : () => {
          openProjectFileDiff(previewChange);
        };
  return (
    <>
      {selectedProjectFileDialog === null ? null : (
        <ProjectSourceDialog
          client={client}
          onClose={() => {
            setProjectFileDialogSelection(null);
          }}
          {...(openPreviewDiff === undefined ? {} : { onOpenDiff: openPreviewDiff })}
          previewKind={selectedProjectFileDialog.kind}
          projectId={projectId}
          reference={selectedProjectFileDialog.reference}
          {...(selectedRootPath === undefined ? {} : { rootPath: selectedRootPath })}
        />
      )}
      <FileDiffDialog
        change={selectedProjectFileDiffDialog?.change ?? null}
        onClose={() => {
          setProjectFileDiffDialogSelection(null);
        }}
      />
      {selectedFileReview === null ? null : (
        <FileReviewDialog
          changes={selectedFileReview}
          onClose={() => {
            setFileReviewSelection(null);
          }}
        />
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
