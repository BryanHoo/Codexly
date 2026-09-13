import {
  AgentTaskCatalogSchema,
  CompletedTasksPageSchema,
  UpdateTaskSettingsAndDefaultsResponseSchema,
  type AgentTaskCatalog,
  type CompletedTasksQuery,
  type CompletedTasksPage,
  type UpdateTaskSettingsAndDefaultsRequest,
  type UpdateTaskSettingsAndDefaultsResponse,
} from "@codexly/protocol";
import {
  appendQuery,
  projectPath,
  taskPath,
  type MutationOptions,
  type ReadOptions,
} from "./http-client-transport.js";
import { TaskGoalHttpClient } from "./http-client-task-goals.js";

export class TaskCatalogHttpClient extends TaskGoalHttpClient {
  public updateTaskSettingsAndDefaults(
    projectId: string,
    taskId: string,
    input: UpdateTaskSettingsAndDefaultsRequest,
    options: MutationOptions = {},
  ): Promise<UpdateTaskSettingsAndDefaultsResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/settings-and-defaults`,
      input,
      UpdateTaskSettingsAndDefaultsResponseSchema,
      options,
      "PUT",
    );
  }
  public queryCompletedTasks(
    input: CompletedTasksQuery,
    options: ReadOptions = {},
  ): Promise<CompletedTasksPage> {
    return this.request(
      "/v1/tasks/completed/query",
      CompletedTasksPageSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      undefined,
      { ...options, timeoutMs: this.requestTimeouts.queryMs },
    );
  }
  public listTaskCatalog(
    projectId: string,
    input: Readonly<{ pinned?: true }> = {},
    options: ReadOptions = {},
  ): Promise<AgentTaskCatalog> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/tasks/catalog`, input),
      AgentTaskCatalogSchema,
      options,
    );
  }
}
