import type { TaskActivitySnapshot } from "../../protocol/index.js";
import { invoke } from "./native-invoke.js";

export async function getTaskActivities(): Promise<readonly TaskActivitySnapshot[]> {
  return invoke<readonly TaskActivitySnapshot[]>("get_task_activities");
}

export async function acknowledgeTaskActivity(projectId: string, taskId: string): Promise<void> {
  await invoke("acknowledge_task_activity", { projectId, taskId });
}
