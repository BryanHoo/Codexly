import type { SplitPaneIdentity } from "./split-workspace.js";

const SPLIT_TASK_NAVIGATION_EVENT = "codexly:split-task-navigation";
type TaskPane = SplitPaneIdentity & { taskId: string };

export function requestSplitTaskNavigation(pane: TaskPane): boolean {
  if (typeof window === "undefined") return false;
  // 同步确认工作区是否接管；未挂载或不支持分屏时，调用方立即回退到平台路由。
  return !window.dispatchEvent(
    new CustomEvent<TaskPane>(SPLIT_TASK_NAVIGATION_EVENT, { detail: pane, cancelable: true }),
  );
}

export function subscribeSplitTaskNavigation(select: (pane: TaskPane) => boolean): () => void {
  const listener = (event: Event) => {
    if (!event.defaultPrevented && select((event as CustomEvent<TaskPane>).detail)) {
      // preventDefault 只表示任务已被工作区接管，不改变浏览器历史或页面焦点。
      event.preventDefault();
    }
  };
  window.addEventListener(SPLIT_TASK_NAVIGATION_EVENT, listener);
  return () => {
    window.removeEventListener(SPLIT_TASK_NAVIGATION_EVENT, listener);
  };
}
