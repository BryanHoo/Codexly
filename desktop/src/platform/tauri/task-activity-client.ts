import { listen } from "@tauri-apps/api/event";
import type { TaskActivitySnapshot } from "../../protocol/index.js";
import { invoke } from "./native-invoke.js";

export async function getTaskActivities(): Promise<readonly TaskActivitySnapshot[]> {
  return invoke<readonly TaskActivitySnapshot[]>("get_task_activities");
}

export async function acknowledgeTaskActivity(projectId: string, taskId: string): Promise<void> {
  await invoke("acknowledge_task_activity", { projectId, taskId });
}

export async function resolveAsyncQuestionActivities(projectId: string, taskId: string, questionIds: readonly string[]): Promise<void> {
  await invoke("acknowledge_task_activity", { projectId, taskId, asyncQuestionIds: questionIds });
}

export function listenTaskActivityChanged(listener: () => void): Promise<() => void> {
  return listen("task-activity://changed", listener);
}
