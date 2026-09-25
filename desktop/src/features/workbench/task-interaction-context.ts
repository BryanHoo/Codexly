import { createContext, useContext } from "react";

// 只广播被锁定任务的稳定身份，避免侧栏订阅流式正文或完整 Runtime。
export const TaskInteractionContext = createContext<string | null>(null);
export function useTaskInteractionBlocked(projectId: string, taskId: string): boolean {
  return useContext(TaskInteractionContext) === JSON.stringify([projectId, taskId]);
}
