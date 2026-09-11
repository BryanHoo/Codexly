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
