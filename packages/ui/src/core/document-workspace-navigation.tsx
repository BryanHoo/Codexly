import { useContext, useLayoutEffect } from "react";
import {
  isProjectTaskLocation,
  type TextEditorNavigation,
} from "@codexly/frontend-core/text-editor-navigation";
import { registerTaskLeaveGuard } from "@codexly/frontend-core/split-task-navigation";
import { SplitPaneContext } from "./split-workspace.js";
import type { useDocumentWorkspace } from "./use-document-workspace.js";

/** 路由与分屏共用整个工作区的保存确认，聊天打开时仍覆盖后台未保存文件。 */
export function useDocumentWorkspaceNavigation(
  workspace: Pick<ReturnType<typeof useDocumentWorkspace>, "editors" | "select">,
  history: TextEditorNavigation | undefined,
  projectId: string,
) {
  const pane = useContext(SplitPaneContext);
  const { editors, select } = workspace;
  useLayoutEffect(() => {
    const leave = () => {
      const allowed = editors.requestCloseAll("switch-project");
      if (typeof allowed === "boolean") return allowed;
      return allowed.then((confirmed) => {
        // 失败时回到实际失败文件，让冲突恢复弹窗和错误原因可见。
        if (!confirmed && editors.failedId) void select(editors.failedId);
        return confirmed;
      });
    };
    const unregister = pane ? registerTaskLeaveGuard(pane.pane, leave) : undefined;
    const unblock =
      !pane?.multiple || pane.active
        ? history?.block({
            enableBeforeUnload: false,
            blockerFn: ({ nextLocation }) => {
              if (isProjectTaskLocation(nextLocation.pathname, projectId)) {
                // 新的同项目导航取消旧跨项目意图，但不关闭文件、不保存草稿。
                editors.cancelClose();
                return false;
              }
              const allowed = leave();
              return typeof allowed === "boolean"
                ? !allowed
                : allowed.then((confirmed) => !confirmed);
            },
          })
        : undefined;
    return () => {
      unregister?.();
      unblock?.();
    };
  }, [editors, select, history, projectId, pane]);
}
