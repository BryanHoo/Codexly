import type { SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";
import { SplitInspectorProvider } from "@codexly/ui/core/split-inspector";
import {
  SplitTaskInteractionProvider,
  useReportSplitTaskInteraction,
} from "../split-task-interaction.js";
import {
  SplitWorkspaceProvider,
  SplitWorkspaceGrid,
  useSplitWorkspace,
  SplitPaneContext,
} from "@codexly/ui/core/split-workspace";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { useContext, memo } from "react";
import { Activity } from "react";

import { WorkbenchPetLayer } from "../../pets/components/workbench-pet-layer.js";
import { WorkbenchSettingsPage } from "./workbench-settings-page.js";
import { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellLayout } from "./workbench-shell-layout.js";
import { useWorkbenchShellRuntime, type WorkbenchShellProps } from "./workbench-shell-runtime.js";

function WorkbenchShellContent({
  board = false,
  draftId,
  extensionSection,
  projectId,
  scheduledTasks = false,
  taskId,
  temporary = false,
}: WorkbenchShellProps) {
  const taskScope = taskId === undefined ? { projectId } : { projectId, taskId };
  const workspace = useSplitWorkspace();
  if (workspace === null) throw new Error("Missing split workspace provider");
  const workspaceOnly = workspace.panes.length > 0;
  const shell = useWorkbenchShellRuntime({ ...taskScope, temporary, workspaceOnly });
  const context = useWorkbenchShellController(shell, { ...taskScope, temporary });
  return (
    <SplitInspectorProvider open={context.inspectorOpen} setOpen={context.setInspectorOpen}>
      {/* 隐藏时暂停工作台组件的订阅和快捷键，保留草稿、滚动位置与运行时连接。 */}
      <Activity mode={context.globalSettingsSection === null ? "visible" : "hidden"}>
        <WorkbenchShellLayout
          board={board}
          scheduledTasks={scheduledTasks}
          {...(extensionSection === undefined ? {} : { extensionSection })}
          context={context}
          {...(workspaceOnly
            ? {
                workspaceContent: (
                  <SplitWorkspaceGrid
                    sidebarOpen={context.sidebarOpen}
                    label={context.t("split.label")}
                    toggleSidebar={() => context.setSidebarOpen((open) => !open)}
                  >
                    {(pane) => (
                      <WorkbenchTaskPane {...pane} />
                    )}
                  </SplitWorkspaceGrid>
                ),
              }
            : {})}
          {...(draftId === undefined ? {} : { draftId })}
          {...taskScope}
          temporary={temporary}
        />
      </Activity>
      <WorkbenchSettingsPage context={context} projectToolsEnabled={!temporary} />
      <WorkbenchPetLayer settings={context.globalSettings?.pet} />
    </SplitInspectorProvider>
  );
}

// 外层只管理侧栏和全局设置；各窗口独立订阅任务，避免重复读取同一份聊天历史。
export function WorkbenchShell(props: WorkbenchShellProps) {
  const current =
    props.taskId === undefined ? undefined : { projectId: props.projectId, taskId: props.taskId };
  const routeKey = JSON.stringify(props);
  return (
    <SplitWorkspaceProvider current={current} routeKey={routeKey} desktop>
      <SplitTaskInteractionProvider>
        <WorkbenchShellContent {...props} />
      </SplitTaskInteractionProvider>
    </SplitWorkspaceProvider>
  );
}

const WorkbenchTaskPane = memo(function WorkbenchTaskPane({
  projectId,
  taskId,
  draftId,
}: SplitPaneIdentity) {
  const pane = useContext(SplitPaneContext);
  if (pane === null) throw new Error("Missing split pane provider");
  const temporary = projectId === TEMPORARY_TASK_SCOPE_ID;
  const scope = { projectId, ...(taskId === undefined ? {} : { taskId }), temporary };
  const shell = useWorkbenchShellRuntime({
    ...scope,
    paneOnly: true,
    paneActive: pane.active,
  });
  useReportSplitTaskInteraction(
    projectId,
    taskId,
    shell.runtime.writeAccess !== undefined && shell.runtime.writeAccess !== "writable",
  );
  const context = useWorkbenchShellController(shell, scope);
  return (
    <WorkbenchShellLayout
      context={context}
      {...(draftId === undefined ? {} : { composerDraftId: draftId })}
      {...scope}
      board={false}
      scheduledTasks={false}
      embedded
    />
  );
});
