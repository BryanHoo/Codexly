import { useEffect, useRef } from "react";
import { useProjectActions } from "../../projects/project-context.js";

type UseProjectGitStatusRefreshOptions = Readonly<{
  enabled: boolean;
  projectId: string;
  rootPath: string;
  scopeKey: string;
  worktree: boolean;
}>;

export function refreshProjectGitStatusForScopeChange(
  previousScopeKey: string,
  scopeKey: string,
  enabled: boolean,
  refresh: () => unknown,
): string {
  if (enabled && previousScopeKey !== scopeKey) void refresh();
  return scopeKey;
}

export function useProjectGitStatusRefresh({
  enabled,
  projectId,
  rootPath,
  scopeKey,
  worktree,
}: UseProjectGitStatusRefreshOptions): void {
  const { observeProjectGitStatus, syncProjectGitStatus } = useProjectActions();
  const previousScopeKeyRef = useRef(scopeKey);

  useEffect(() => {
    if (!enabled) return;
    // 根目录登记不依赖 Task 身份，切换任务时不会重建共享焦点监听或轮询计时器。
    return observeProjectGitStatus(projectId, rootPath, worktree);
  }, [enabled, observeProjectGitStatus, projectId, rootPath, worktree]);

  useEffect(() => {
    // 同一工作台内切换 Task 不会重新挂载 Query，需要主动校准 Git 状态。
    previousScopeKeyRef.current = refreshProjectGitStatusForScopeChange(
      previousScopeKeyRef.current,
      scopeKey,
      enabled,
      () => {
        syncProjectGitStatus(projectId, rootPath);
      },
    );
  }, [enabled, projectId, rootPath, scopeKey, syncProjectGitStatus]);
}
