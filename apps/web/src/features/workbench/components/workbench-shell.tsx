import {
  ROUTE_SPLIT_DRAFT_ID,
  type SplitPaneIdentity,
} from "@codexly/frontend-core/split-workspace";
import { SplitInspectorProvider } from "@codexly/ui/core/split-inspector";
import {
  SplitWorkspaceProvider,
  SplitWorkspaceGrid,
  useSplitWorkspace,
  SplitPaneContext,
} from "@codexly/ui/core/split-workspace";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { useContext, memo } from "react";
import { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellLayout } from "./workbench-shell-layout.js";
import { useWorkbenchShellRuntime, type WorkbenchShellProps } from "./workbench-shell-runtime.js";

function WorkbenchShellContent({
  board = false,
  extensionSection,
  projectId,
  scheduled = false,
  taskId,
  temporary = false,
  todoId,
}: WorkbenchShellProps) {
  const taskScope = taskId === undefined ? { projectId } : { projectId, taskId };
  const workspace = useSplitWorkspace();
  if (workspace === null) throw new Error("Missing split workspace provider");
  const workspaceOnly = workspace.panes.length > 0;
  const shell = useWorkbenchShellRuntime({ ...taskScope, temporary, workspaceOnly });
  const context = useWorkbenchShellController(shell, { ...taskScope, temporary });
  return (
    <SplitInspectorProvider open={context.inspectorOpen} setOpen={context.setInspectorOpen}>
      <WorkbenchShellLayout
        board={board}
        context={context}
        {...(workspaceOnly
          ? {
              workspaceContent: (
                <SplitWorkspaceGrid
                  sidebarOpen={context.sidebarOpen}
                  label={context.t("split.label")}
                  splitLabels={{
                    up: context.t("split.up"),
                    down: context.t("split.down"),
                    left: context.t("split.left"),
                    right: context.t("split.right"),
                    limit: context.t("split.limit"),
                    resizeWidth: context.t("split.resizeWidth"),
                    resizeHeight: context.t("split.resizeHeight"),
                  }}
                  toggleSidebar={() => {
                    context.setSidebarOpen((open) => !open);
                  }}
                >
                  {(pane) => (
                    <WorkbenchTaskPane
                      {...pane}
                      {...(todoId === undefined || pane.draftId !== ROUTE_SPLIT_DRAFT_ID
                        ? {}
                        : { todoId })}
                    />
                  )}
                </SplitWorkspaceGrid>
              ),
            }
          : {})}
        {...(extensionSection === undefined ? {} : { extensionSection })}
        scheduled={scheduled}
        {...taskScope}
        temporary={temporary}
        {...(todoId === undefined ? {} : { todoId })}
      />
    </SplitInspectorProvider>
  );
}

// 外层只管理侧栏和全局设置；各窗口独立订阅任务，避免重复读取同一份聊天历史。
export function WorkbenchShell(props: WorkbenchShellProps) {
  const current =
    props.taskId === undefined
      ? props.board || props.scheduled || props.extensionSection !== undefined
        ? undefined
        : { projectId: props.projectId, draftId: ROUTE_SPLIT_DRAFT_ID }
      : { projectId: props.projectId, taskId: props.taskId };
  const routeKey = JSON.stringify(props);
  return (
    <SplitWorkspaceProvider current={current} routeKey={routeKey}>
      <WorkbenchShellContent {...props} />
    </SplitWorkspaceProvider>
  );
}

const WorkbenchTaskPane = memo(function WorkbenchTaskPane({
  projectId,
  taskId,
  draftId,
  todoId,
}: SplitPaneIdentity & { todoId?: string }) {
  const pane = useContext(SplitPaneContext);
  if (pane === null) throw new Error("Missing split pane provider");
  const temporary = projectId === TEMPORARY_TASK_SCOPE_ID;
  const scope = { projectId, ...(taskId === undefined ? {} : { taskId }), temporary };
  const shell = useWorkbenchShellRuntime({
    ...scope,
    paneOnly: true,
    paneActive: pane.active,
  });
  const context = useWorkbenchShellController(shell, scope);
  return (
    <WorkbenchShellLayout
      context={context}
      {...scope}
      {...(draftId === undefined || draftId === ROUTE_SPLIT_DRAFT_ID
        ? {}
        : { composerDraftId: draftId })}
      {...(todoId === undefined ? {} : { todoId })}
      board={false}
      scheduled={false}
      embedded
    />
  );
});
