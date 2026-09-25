import { Activity } from "react";

import { WorkbenchPetLayer } from "../../pets/components/workbench-pet-layer.js";
import { WorkbenchSettingsPage } from "./workbench-settings-page.js";
import { useWorkbenchShellController } from "./workbench-shell-controller.js";
import { WorkbenchShellLayout } from "./workbench-shell-layout.js";
import { useWorkbenchShellRuntime, type WorkbenchShellProps } from "./workbench-shell-runtime.js";

export function WorkbenchShell({
  board = false,
  draftId,
  extensionSection,
  projectId,
  scheduledTasks = false,
  taskId,
  temporary = false,
}: WorkbenchShellProps) {
  const taskScope = taskId === undefined ? { projectId } : { projectId, taskId };
  const shell = useWorkbenchShellRuntime({ ...taskScope, temporary });
  const context = useWorkbenchShellController(shell, { ...taskScope, temporary });
  return (
    <>
      {/* 隐藏时暂停工作台组件的订阅和快捷键，保留草稿、滚动位置与运行时连接。 */}
      <Activity mode={context.globalSettingsSection === null ? "visible" : "hidden"}>
        <WorkbenchShellLayout
          board={board}
          scheduledTasks={scheduledTasks}
          {...(extensionSection === undefined ? {} : { extensionSection })}
          context={context}
          {...(draftId === undefined ? {} : { draftId })}
          {...taskScope}
          temporary={temporary}
        />
      </Activity>
      <WorkbenchSettingsPage context={context} projectToolsEnabled={!temporary} />
      <WorkbenchPetLayer settings={context.globalSettings?.pet} />
    </>
  );
}
