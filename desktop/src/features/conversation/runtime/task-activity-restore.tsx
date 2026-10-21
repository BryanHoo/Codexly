import { installTaskActivitySync } from "@codexly/frontend-core/task-activity-sync";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getTaskActivities, listenTaskActivityChanged } from "../../../platform/tauri/task-activity-client.js";
import { listenScheduledTaskStarted } from "../../../platform/tauri/scheduled-task-events.js";
import { cacheCreatedProjectTask } from "../../projects/project-query-cache.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import { useProjectActions } from "../../projects/project-context.js";

export function TaskActivityRestore() {
  const { projectRuntime } = useProjectActions();
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    // 定时任务可在任意页面启动，通过全局轻量通知补入左栏，不依赖已打开的项目订阅。
    void listenScheduledTaskStarted((task) => {
      if (!active) return;
      void (async () => {
        await cacheCreatedProjectTask(queryClient, task);
        if (!active) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] }),
          projectRuntime.refreshTaskSnapshot(task.projectId, task.id),
        ]);
      })().catch((error: unknown) => recordInternalWarning("scheduled_task_sync_failed", error));
    }).then((cleanup) => {
      // 异步注册若晚于组件卸载，立即释放监听，避免重复订阅。
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch((error: unknown) => recordInternalWarning("scheduled_task_listener_failed", error));
    return () => {
      active = false;
      unlisten?.();
    };
  }, [projectRuntime, queryClient]);

  useEffect(() => installTaskActivitySync({
    read: getTaskActivities,
    capture: () => projectRuntime.getTaskActivity(),
    apply: (tasks, baseline) => projectRuntime.reconcileTaskActivities(tasks, baseline),
    subscribe: listenTaskActivityChanged,
    onError: (error) => recordInternalWarning("task_activity_restore_failed", error),
    target: document, window,
  }), [projectRuntime]);

  return null;
}
