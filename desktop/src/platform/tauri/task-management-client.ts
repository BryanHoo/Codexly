import type {
  PinAgentTaskResponse,
  RenameAgentTaskResponse,
  ArchiveAgentTaskResponse,
  UnarchiveAgentTaskResponse,
  DeleteAgentTaskResponse,
} from "@/protocol/index.js";
import { TauriTaskLifecycleClient } from "./task-lifecycle-client.js";

/** 原生 UI 契约由 Rust 返回边界包装；ACP 管理失败不能改投旧执行器。 */
export class TauriTaskManagementClient extends TauriTaskLifecycleClient {
  public pinTask(
    projectId: string,
    taskId: string,
    pinned: boolean,
  ): Promise<PinAgentTaskResponse> {
    return this.#mutate(projectId, taskId, "pin", { pinned });
  }
  public renameTask(
    projectId: string,
    taskId: string,
    title: string,
  ): Promise<RenameAgentTaskResponse> {
    return this.#mutate(projectId, taskId, "rename", { title });
  }
  public archiveTask(projectId: string, taskId: string): Promise<ArchiveAgentTaskResponse> {
    return this.#mutate(projectId, taskId, "archive");
  }
  public unarchiveTask(projectId: string, taskId: string): Promise<UnarchiveAgentTaskResponse> {
    return this.#mutate(projectId, taskId, "unarchive");
  }
  public deleteTask(projectId: string, taskId: string): Promise<DeleteAgentTaskResponse> {
    return this.#mutate(projectId, taskId, "delete");
  }

  async #mutate<T>(
    projectId: string,
    taskId: string,
    operation: "pin" | "rename" | "archive" | "unarchive" | "delete",
    input: Record<string, unknown> = {},
  ): Promise<T> {
    if ((await this.applicationRuntime()) !== "acp")
      return this.call(`${operation}_task`, { projectId, taskId, ...input });
    this.taskProjects.set(taskId, projectId);
    const response = await this.call<T>("acp_task_request", {
      projectId,
      method: `task.${operation}`,
      params: { taskId, ...input },
    });
    // 只有明确删除成功才遗忘身份；在途保留/释放先退出，避免迟到身份泄漏。
    if (operation === "delete") await this.forgetTaskSubscription(projectId, taskId);
    return response;
  }
}
