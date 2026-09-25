import { lazy } from "react";

// 定时任务是低频独立视图，按需加载可保持常用工作区启动体积稳定。
export const LazyScheduledTasksContainer = lazy(async () => {
  const module = await import("../../scheduled-tasks/scheduled-tasks-container.js");
  return { default: module.ScheduledTasksContainer };
});
