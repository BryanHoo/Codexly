import {
  DeleteScheduledTaskResponseSchema,
  ScheduledTaskMutationResponseSchema,
  ScheduledTaskPageSchema,
  type DeleteScheduledTaskResponse,
  type ScheduledTaskInput,
  type ScheduledTaskMutationResponse,
  type ScheduledTaskPage,
} from "@codexly/protocol";

import type { MutationOptions, ReadOptions } from "./http-client-transport.js";
import { TaskHttpClient } from "./http-client-tasks.js";

export class ScheduledTaskHttpClient extends TaskHttpClient {
  public listScheduledTasks(options: ReadOptions = {}): Promise<ScheduledTaskPage> {
    return this.read("/v1/scheduled-tasks", ScheduledTaskPageSchema, options);
  }

  public createScheduledTask(
    input: ScheduledTaskInput,
    options: MutationOptions = {},
  ): Promise<ScheduledTaskMutationResponse> {
    return this.mutation(
      "/v1/scheduled-tasks",
      input,
      ScheduledTaskMutationResponseSchema,
      options,
    );
  }

  public updateScheduledTask(
    taskId: string,
    input: ScheduledTaskInput,
    options: MutationOptions = {},
  ): Promise<ScheduledTaskMutationResponse> {
    return this.mutation(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}`,
      input,
      ScheduledTaskMutationResponseSchema,
      options,
      "PUT",
    );
  }

  public deleteScheduledTask(
    taskId: string,
    options: MutationOptions = {},
  ): Promise<DeleteScheduledTaskResponse> {
    return this.mutation(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}`,
      {},
      DeleteScheduledTaskResponseSchema,
      options,
      "DELETE",
    );
  }

  public setScheduledTaskEnabled(
    taskId: string,
    enabled: boolean,
    options: MutationOptions = {},
  ): Promise<ScheduledTaskMutationResponse> {
    return this.mutation(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}/enabled`,
      { enabled },
      ScheduledTaskMutationResponseSchema,
      options,
      "PATCH",
    );
  }

  public runScheduledTaskNow(
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ScheduledTaskMutationResponse> {
    return this.mutation(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}/run`,
      {},
      ScheduledTaskMutationResponseSchema,
      options,
    );
  }
}
