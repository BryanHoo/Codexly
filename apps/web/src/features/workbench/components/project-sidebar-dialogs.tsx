import type { AgentTask, Project } from "@code-agent/protocol";
import type { ComponentProps } from "react";

import { ProjectDirectoryPickerDialog } from "../../projects/components/project-directory-picker-dialog.js";
import { ProjectRemoveDialog } from "./project-remove-dialog.js";
import { ProjectRenameDialog } from "./project-rename-dialog.js";
import { TaskRenameDialog } from "./task-rename-dialog.js";

type ProjectSidebarDialogsProps = Readonly<{
  client: ComponentProps<typeof ProjectDirectoryPickerDialog>["client"];
  isProjectActionPending: boolean;
  isProjectAddPending: boolean;
  isProjectPickerOpen: boolean;
  onAddProject: (rootPaths: readonly string[]) => Promise<void>;
  onCloseProjectDialog: (projectId: string) => void;
  onCloseProjectPicker: () => void;
  onCloseTaskRename: () => void;
  onRemoveProject: (project: Project) => void;
  onRenameProject: (project: Project, name: string) => void;
  onRenameTask: (task: AgentTask, title: string) => void;
  removingProject: Project | null;
  renamingProject: Project | null;
  renamingTask: AgentTask | null;
  taskRenamePending: boolean;
}>;

export function ProjectSidebarDialogs({
  client,
  isProjectActionPending,
  isProjectAddPending,
  isProjectPickerOpen,
  onAddProject,
  onCloseProjectDialog,
  onCloseProjectPicker,
  onCloseTaskRename,
  onRemoveProject,
  onRenameProject,
  onRenameTask,
  removingProject,
  renamingProject,
  renamingTask,
  taskRenamePending,
}: ProjectSidebarDialogsProps) {
  return (
    <>
      {renamingTask === null ? null : (
        <TaskRenameDialog
          initialTitle={renamingTask.title}
          isPending={taskRenamePending}
          key={renamingTask.id}
          onClose={onCloseTaskRename}
          onRename={(title) => {
            onRenameTask(renamingTask, title);
          }}
        />
      )}

      {isProjectPickerOpen ? (
        <ProjectDirectoryPickerDialog
          client={client}
          isAdding={isProjectAddPending}
          onAdd={onAddProject}
          onClose={onCloseProjectPicker}
        />
      ) : null}

      {renamingProject === null ? null : (
        <ProjectRenameDialog
          initialName={renamingProject.name}
          isPending={isProjectActionPending}
          key={renamingProject.id}
          onClose={() => {
            onCloseProjectDialog(renamingProject.id);
          }}
          onRename={(name) => {
            onRenameProject(renamingProject, name);
          }}
        />
      )}

      {removingProject === null ? null : (
        <ProjectRemoveDialog
          isPending={isProjectActionPending}
          key={removingProject.id}
          onClose={() => {
            onCloseProjectDialog(removingProject.id);
          }}
          onRemove={() => {
            onRemoveProject(removingProject);
          }}
          project={removingProject}
        />
      )}
    </>
  );
}
