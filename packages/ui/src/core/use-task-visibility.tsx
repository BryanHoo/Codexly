import { useLayoutEffect } from "react";

interface TaskVisibilityRuntime {
  observeVisibleTask(projectId: string, taskId: string): () => void;
}

/** 按实际渲染生命周期登记；Activity 隐藏时自动清理，不依赖点击、滚动或活动窗口。 */
export function useTaskVisibility(
  runtime: TaskVisibilityRuntime,
  projectId: string,
  taskId: string | undefined,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    if (enabled && taskId !== undefined) return runtime.observeVisibleTask(projectId, taskId);
  }, [runtime, projectId, taskId, enabled]);
}
