import { createContext, useContext } from "react";
import { SplitTaskInteractionContext } from "./split-task-interaction.js";

// 只广播被锁定任务的稳定身份，避免侧栏订阅流式正文或完整 Runtime。
export const TaskInteractionContext = createContext<string | null>(null);
export function useTaskInteractionBlocked(projectId: string, taskId: string): boolean {
  const local = useContext(TaskInteractionContext);
  const split = useContext(SplitTaskInteractionContext);
  const key = JSON.stringify([projectId, taskId]);
  return local === key || split.has(key);
}
