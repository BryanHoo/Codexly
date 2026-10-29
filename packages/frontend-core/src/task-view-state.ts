type TaskIdentity = Readonly<{ projectId: string; taskId: string }>;
const taskKey = (projectId: string, taskId: string) => JSON.stringify([projectId, taskId]);

/** 两端共用可见任务登记；焦点仅决定输入归属，不限制分屏中哪些任务已被阅读。 */
export function createTaskViewState(
  onRead: (projectId: string, taskId: string) => void,
  target = typeof document === "undefined" ? undefined : document,
  windowTarget = typeof window === "undefined" ? undefined : window,
) {
  const visible = new Map<string, TaskIdentity & { observers: number }>();
  let selected: TaskIdentity | undefined;
  const foreground = () => target?.visibilityState !== "hidden";
  const isViewed = (projectId: string, taskId: string) =>
    foreground() &&
    (visible.has(taskKey(projectId, taskId)) ||
      (selected?.projectId === projectId && selected.taskId === taskId));
  const readVisible = () => {
    if (!foreground()) return;
    for (const task of visible.values()) onRead(task.projectId, task.taskId);
    if (selected && !visible.has(taskKey(selected.projectId, selected.taskId)))
      onRead(selected.projectId, selected.taskId);
  };
  const stopListening = () => {
    target?.removeEventListener("visibilitychange", readVisible);
    windowTarget?.removeEventListener("focus", readVisible);
  };
  return {
    isViewed,
    readVisible,
    view(projectId: string, taskId?: string) {
      selected = taskId === undefined ? undefined : { projectId, taskId };
      if (taskId !== undefined && foreground()) onRead(projectId, taskId);
    },
    observe(projectId: string, taskId: string) {
      if (visible.size === 0) {
        target?.addEventListener("visibilitychange", readVisible);
        windowTarget?.addEventListener("focus", readVisible);
      }
      const key = taskKey(projectId, taskId);
      const previous = visible.get(key);
      visible.set(key, { projectId, taskId, observers: (previous?.observers ?? 0) + 1 });
      if (foreground()) onRead(projectId, taskId);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const current = visible.get(key);
        if (current && current.observers > 1)
          visible.set(key, { ...current, observers: current.observers - 1 });
        else {
          visible.delete(key);
          // React Activity 隐藏或任务离开页面时，不能继续用旧焦点吞掉后台通知。
          if (selected?.projectId === projectId && selected.taskId === taskId) selected = undefined;
        }
        if (visible.size === 0) stopListening();
      };
    },
    forget(projectId: string, taskId?: string) {
      for (const [key, task] of visible) {
        if (task.projectId === projectId && (taskId === undefined || task.taskId === taskId))
          visible.delete(key);
      }
      if (selected?.projectId === projectId && (taskId === undefined || selected.taskId === taskId))
        selected = undefined;
      if (visible.size === 0) stopListening();
    },
    dispose() {
      stopListening();
      visible.clear();
      selected = undefined;
    },
  };
}
