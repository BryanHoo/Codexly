import { useContext, useState } from "react";
import type {
  CreateProjectWorktreeRequest,
  ProjectGitWorktreePage,
  ProjectGitStatus,
} from "@codexly/protocol";
import { SplitPaneContext, useOpenSplitDraft } from "./split-workspace.js";

export type ComposerWorkspace = Readonly<{
  projectId: string;
  rootPath: string;
  select: (path: string) => void;
  client: {
    listProjectWorktrees: (projectId: string, rootPath: string) => Promise<ProjectGitWorktreePage>;
    getProjectGitStatus: (
      projectId: string,
      input: { rootPath: string },
    ) => Promise<ProjectGitStatus>;
    createTaskWorktree: (
      projectId: string,
      rootPath: string,
      input: CreateProjectWorktreeRequest,
    ) => Promise<{ worktree: { path: string } }>;
  };
}>;

/** 工作目录属于当前草稿；创建或切换工作树不提前确定执行引擎。 */
export function useComposerWorkspaceSelection(projectId: string, taskId: string | undefined) {
  const pane = useContext(SplitPaneContext);
  const openDraft = useOpenSplitDraft();
  const scope = JSON.stringify([projectId, pane?.pane.draftId ?? null, taskId ?? null]);
  const [selection, setSelection] = useState<{ scope: string; path: string }>();
  const path =
    taskId === undefined
      ? selection?.scope === scope
        ? selection.path
        : pane?.pane.workspacePath
      : undefined;
  const select = (path: string) => {
    // 已有会话保留执行目录，新的草稿携带目录，分屏中只替换发起操作的窗口。
    if (taskId !== undefined && openDraft(projectId, path)) return;
    setSelection({ scope, path });
  };
  return { path, select };
}
