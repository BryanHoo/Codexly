import { useMutation } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import { useRef, useState } from "react";

import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";
import {
  ProjectFileDeleteDialog,
  ProjectFileRenameDialog,
} from "./project-file-mutation-dialog.js";

type ProjectFileMutationAction = "delete" | "rename";

export function getProjectFileParentPath(path: string): string | null {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1 ? null : path.slice(0, separatorIndex);
}

export function useProjectFileMutations({
  client,
  name,
  onRefreshDirectory,
  path,
  projectId,
  projectPath,
  targetType,
}: Readonly<{
  client: CodexlyFileTreeClient;
  name: string;
  onRefreshDirectory: (path: string | null) => void;
  path: string | null;
  projectId: string;
  projectPath: string;
  targetType: "directory" | "file";
}>) {
  const [action, setAction] = useState<ProjectFileMutationAction | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: Readonly<{ action: ProjectFileMutationAction; name?: string }>) => {
      if (path === null) throw new TypeError("Project file path is unavailable");
      const options = { idempotencyKey: idempotencyKeyRef.current ?? createUuid() };
      if (input.action === "rename" && input.name !== undefined) {
        return client.renameProjectFile(
          projectId,
          projectPath,
          { name: input.name, path },
          options,
        );
      }
      return client.deleteProjectFile(projectId, projectPath, { path }, options);
    },
    onSuccess: () => {
      setAction(null);
      idempotencyKeyRef.current = null;
      if (path !== null) onRefreshDirectory(getProjectFileParentPath(path));
    },
  });
  const openAction = (nextAction: ProjectFileMutationAction) => {
    idempotencyKeyRef.current = createUuid();
    setAction(nextAction);
  };
  const close = () => {
    if (!mutation.isPending) {
      setAction(null);
      idempotencyKeyRef.current = null;
    }
  };
  const dialog =
    path === null || action === null ? null : action === "rename" ? (
      <ProjectFileRenameDialog
        initialName={name}
        isPending={mutation.isPending}
        onClose={close}
        onRename={(nextName) => {
          mutation.mutate({ action: "rename", name: nextName });
        }}
        targetType={targetType}
      />
    ) : (
      <ProjectFileDeleteDialog
        isPending={mutation.isPending}
        name={name}
        onClose={close}
        onDelete={() => {
          mutation.mutate({ action: "delete" });
        }}
        targetType={targetType}
      />
    );
  return {
    dialog,
    isPending: mutation.isPending,
    openDelete: () => {
      openAction("delete");
    },
    openRename: () => {
      openAction("rename");
    },
  };
}
