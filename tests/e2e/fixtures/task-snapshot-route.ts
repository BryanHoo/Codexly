// 快照请求可携带摘要、分页等参数；仅匹配完整路径，避免误拦截设置、队列和过程子接口。
export function taskSnapshotRoute(taskId: string, projectId = "codexly") {
  const pathname = `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`;
  return (url: URL): boolean => url.pathname === pathname;
}
