import {
  ClearAgentGoalResponseSchema,
  UpdateAgentGoalResponseSchema,
  type ClearAgentGoalResponse,
  type UpdateAgentGoalRequest,
  type UpdateAgentGoalResponse,
} from "@codexly/protocol";

import { taskPath, type MutationOptions } from "./http-client-transport.js";
import { TaskArchiveHttpClient } from "./http-client-task-archive.js";

export class TaskGoalHttpClient extends TaskArchiveHttpClient {
  public async updateTaskGoal(
    projectId: string,
    taskId: string,
    input: UpdateAgentGoalRequest,
    options: MutationOptions = {},
  ): Promise<UpdateAgentGoalResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/goal`,
      input,
      UpdateAgentGoalResponseSchema,
      options,
      "PUT",
    );
  }

  public async clearTaskGoal(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ClearAgentGoalResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/goal`,
      {},
      ClearAgentGoalResponseSchema,
      options,
      "DELETE",
    );
  }
}
