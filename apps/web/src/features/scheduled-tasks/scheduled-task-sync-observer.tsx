import type { CodexlyClient } from "@codexly/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { scheduledTasksQueryKey, scheduledTasksQueryOptions } from "./scheduled-task-sync.js";

// 挂载于全局 Provider，离开定时任务页面后仍同步自动执行产生的新任务。
export function ScheduledTaskSyncObserver({
  client,
}: Readonly<{ client: Pick<CodexlyClient, "listScheduledTasks" | "subscribeScheduledTasks"> }>) {
  const queryClient = useQueryClient();
  useQuery(scheduledTasksQueryOptions(client, queryClient));
  useEffect(() => {
    let active = true;
    let dirty = false;
    let running = false;
    const isActive = () => active;
    const refresh = async () => {
      if (running || !active) return;
      running = true;
      try {
        while (isActive() && dirty) {
          dirty = false;
          // 共享正在进行的请求；请求途中再来通知，完成后补读一次，避免丢失最终状态。
          await queryClient.invalidateQueries(
            { queryKey: scheduledTasksQueryKey },
            { cancelRefetch: false },
          );
        }
      } finally {
        running = false;
      }
    };
    const unsubscribe = client.subscribeScheduledTasks(() => {
      dirty = true;
      queueMicrotask(() => {
        void refresh();
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, queryClient]);
  return null;
}
