import {
  AgentTaskCatalogSchema,
  CompletedTasksPageSchema,
  type AgentTaskCatalog,
  type CompletedTasksQuery,
  type CompletedTasksPage,
} from "@codexly/protocol";
import { appendQuery, projectPath, type ReadOptions } from "./http-client-transport.js";
import { TaskGoalHttpClient } from "./http-client-task-goals.js";

export class TaskCatalogHttpClient extends TaskGoalHttpClient {
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
