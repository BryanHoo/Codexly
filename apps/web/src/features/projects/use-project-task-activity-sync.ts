import { useEffect } from "react";
import { installTaskActivitySync } from "@codexly/frontend-core/task-activity-sync";
import type { ProjectRuntimeManager } from "../conversation/runtime/project-runtime.js";
import { recordInternalWarning } from "../notifications/internal-diagnostics.js";
import type { CodexlyClient } from "@codexly/client";

/** Provider 级同步只安装一次，侧栏、任务看板和分屏共用同一个活动源。 */
export function useProjectTaskActivitySync(
  client: Pick<
    CodexlyClient,
    "getTaskActivities" | "acknowledgeTaskActivity" | "subscribeWorkbenchChanges"
  >,
  projectRuntime: ProjectRuntimeManager,
): void {
  useEffect(() => {
    projectRuntime.onTaskActivityViewed = (projectId, taskId, version) => {
      void client.acknowledgeTaskActivity(projectId, taskId, version).catch((error: unknown) => {
        recordInternalWarning("task_activity_acknowledge_failed", error);
      });
    };
    const stop = installTaskActivitySync({
      read: async () => (await client.getTaskActivities()).data,
      capture: () => projectRuntime.getTaskActivity(),
      apply: (tasks, baseline) => {
        projectRuntime.reconcileTaskActivities(tasks, baseline);
      },
      subscribe: (refresh) =>
        client.subscribeWorkbenchChanges((change) => {
          if (change.type === "workbench.ready" || change.type === "task-activity.changed")
            refresh();
        }),
      onError: (error) => {
        recordInternalWarning("task_activity_sync_failed", error);
      },
      target: document,
      window,
    });
    return () => {
      projectRuntime.onTaskActivityViewed = undefined;
      stop();
    };
  }, [client, projectRuntime]);
}
