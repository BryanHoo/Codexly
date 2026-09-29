import { resolveWorkbenchTaskRoot } from "@codexly/frontend-core";

export function resolveDesktopTaskRoot(input: Parameters<typeof resolveWorkbenchTaskRoot>[0]) {
  const result = resolveWorkbenchTaskRoot(input);
  if (result.activeRootId !== "worktree" || result.selectedRootPath === undefined) return result;
  // 原生终端以 rootId 隔离会话；使用任务 ID，避免长路径超出 IPC 标识长度限制。
  const id = `worktree:${input.taskId}`;
  return { ...result, activeRootId: id, projectRoots: [{ id, path: result.selectedRootPath }] };
}
