import {
  ArchiveAgentTaskResponseSchema,
  DeleteAgentTaskResponseSchema,
  UnarchiveAgentTaskResponseSchema,
  type ArchiveAgentTaskResponse,
  type DeleteAgentTaskResponse,
  type UnarchiveAgentTaskResponse,
} from "@code-agent/protocol";

import { taskPath, type MutationOptions } from "./http-client-transport.js";
import { ProjectHttpClient } from "./http-client-projects.js";

// 归档生命周期独立于普通 Task 操作，避免主 Client 模块继续膨胀。
export class TaskArchiveHttpClient extends ProjectHttpClient {
  public async archiveTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ArchiveAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/archive`,
      {},
      ArchiveAgentTaskResponseSchema,
      options,
    );
  }

  public async unarchiveTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<UnarchiveAgentTaskResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/unarchive`,
      {},
      UnarchiveAgentTaskResponseSchema,
      options,
    );
  }

  public async deleteTask(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<DeleteAgentTaskResponse> {
    return this.mutation(
      taskPath(projectId, taskId),
      {},
      DeleteAgentTaskResponseSchema,
      options,
      "DELETE",
    );
  }
}
