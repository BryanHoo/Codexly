import type { AgentProvider, AgentProviderTaskSnapshot } from "@codexly/core";

const UNAVAILABLE_TASK_MESSAGE =
  /thread.*(?:not loaded|not found|does not exist|deleted|archived)|no rollout found/iu;

export async function readNavigableProviderTask(
  provider: AgentProvider,
  projectId: string,
  taskId: string,
): Promise<AgentProviderTaskSnapshot | null> {
  let task: AgentProviderTaskSnapshot | undefined;
  try {
    task = await provider.readTask(taskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (UNAVAILABLE_TASK_MESSAGE.test(message)) return null;
    throw error;
  }
  if (task?.projectId !== projectId) return null;
  // 只接受按身份确认未归档的任务；删除或作用域变化均不再通过列表扫描兜底。
  if ((await provider.isTaskArchived(taskId)) !== false) return null;
  return task;
}
