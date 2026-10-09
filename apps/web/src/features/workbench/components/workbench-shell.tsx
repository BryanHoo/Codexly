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
    <WorkbenchShellLayout
      board={board}
      context={context}
      {...(workspaceOnly
        ? {
            workspaceContent: (
              <SplitWorkspaceGrid
                sidebarOpen={context.sidebarOpen}
                label={context.t("split.label")}
                toggleSidebar={() => {
                  context.setSidebarOpen((open) => !open);
                }}
              >
                {(pane) => <WorkbenchTaskPane projectId={pane.projectId} taskId={pane.taskId} />}
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
  );
}

// 外层只管理侧栏和全局设置；各窗口独立订阅任务，避免重复读取同一份聊天历史。
export function WorkbenchShell(props: WorkbenchShellProps) {
  const current =
    props.taskId === undefined ? undefined : { projectId: props.projectId, taskId: props.taskId };
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
}: {
  projectId: string;
  taskId: string;
}) {
  const pane = useContext(SplitPaneContext);
  if (pane === null) throw new Error("Missing split pane provider");
  const temporary = projectId === TEMPORARY_TASK_SCOPE_ID;
  const scope = { projectId, taskId, temporary };
  const shell = useWorkbenchShellRuntime({
    ...scope,
    paneOnly: true,
    paneActive: pane.active,
    compactPane: pane.multiple,
  });
  const context = useWorkbenchShellController(shell, scope);
  return (
    <WorkbenchShellLayout context={context} {...scope} board={false} scheduled={false} embedded />
  );
});
