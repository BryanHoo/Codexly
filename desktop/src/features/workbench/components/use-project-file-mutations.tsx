import { useMutation } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import { useRef, useState } from "react";

import type { NativeFileTreeClient } from "../../projects/project-query-contracts.js";
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
  client: NativeFileTreeClient;
  name: string;
  onRefreshDirectory: (path: string | null) => void;
  path: string | null;
  projectId: string;
  projectPath: string;
  targetType: "directory" | "file";
}>) {
  const [action, setAction] = useState<ProjectFileMutationAction | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submitted = useRef<string | null>(null);
  const submitting = useRef(false);
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
  const submit = (input: Readonly<{ action: ProjectFileMutationAction; name?: string }>) => {
    // 同一事件循环内的双击也互斥；修改名称后换幂等键，结果不明的同输入重试沿用原键。
    if (submitting.current) return;
    const identity = JSON.stringify(input);
    if (submitted.current !== identity) {
      idempotencyKeyRef.current = createUuid();
      submitted.current = identity;
    }
    submitting.current = true;
    mutation.mutate(input, { onSettled: () => { submitting.current = false; } });
  };
  const openAction = (nextAction: ProjectFileMutationAction) => {
    if (submitting.current) return;
    mutation.reset();
    submitted.current = null;
    idempotencyKeyRef.current = createUuid();
    setAction(nextAction);
  };
  const close = () => {
    if (!submitting.current && !mutation.isPending) {
      setAction(null);
      idempotencyKeyRef.current = null;
    }
  };
  const dialog =
    path === null || action === null ? null : action === "rename" ? (
      <ProjectFileRenameDialog
        initialName={name}
        isPending={mutation.isPending}
        error={mutation.error}
        onClose={close}
        onRename={(nextName) => {
          submit({ action: "rename", name: nextName });
        }}
        targetType={targetType}
      />
    ) : (
      <ProjectFileDeleteDialog
        isPending={mutation.isPending}
        error={mutation.error}
        name={name}
        onClose={close}
        onDelete={() => {
          submit({ action: "delete" });
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
