import { useMemo } from "react";
import { useStore } from "zustand";
import { createTaskStore, type TaskStore } from "../../conversation/runtime/task-store.js";
import { createInspectorTaskSelector, type InspectorTask } from "../../conversation/runtime/task-view-selectors.js";

const emptyStore = createTaskStore({ projectId: "", taskId: "" });

export function useInspectorTask(store: TaskStore | undefined, open: boolean, fallback: InspectorTask | undefined) {
  const selector = useMemo(
    () => open && store !== undefined ? createInspectorTaskSelector() : () => undefined,
    [store, open],
  );
  // 关闭面板即解除历史订阅并释放投影，重新打开时读取最新 Store。
  const task = useStore(open ? (store ?? emptyStore) : emptyStore, selector);
  return task ?? fallback;
}
