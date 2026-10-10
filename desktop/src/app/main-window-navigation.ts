import { listenMainWindowNavigation } from "../platform/tauri/main-window-navigation.js";
import { requestSplitTaskNavigation } from "@codexly/frontend-core/split-task-navigation";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";

type NavigateMainWindow = (href: string) => unknown;

export async function installMainWindowNavigation(
  navigate: NavigateMainWindow,
): Promise<() => void> {
  return listenMainWindowNavigation((route) => {
    const href = `/${route.replace(/^\/+/, "")}`;
    // 通知、宠物与状态栏共用原生跳转入口；任务路由先交给当前分屏，保留其布局。
    const taskRoute = /^\/(?:p\/([^/]+)\/t|temporary\/t)\/([^/]+)$/u.exec(href);
    if (taskRoute !== null) {
      try {
        const projectId = taskRoute[1] === undefined
          ? TEMPORARY_TASK_SCOPE_ID
          : decodeURIComponent(taskRoute[1]);
        const taskId = decodeURIComponent(taskRoute[2]!);
        if (requestSplitTaskNavigation({ projectId, taskId })) return;
      } catch {
        // 无法解码的原生路由交还 Router，避免中断后续导航监听。
      }
    }
    // 原生层只传应用内相对路由，统一交给现有 Router 更新而不重载 WebView。
    navigate(href);
  });
}
