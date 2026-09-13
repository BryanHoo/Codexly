import { AgentTaskCatalogSchema, type AgentTaskCatalog } from "@codexly/protocol";
import { appendQuery, projectPath, type ReadOptions } from "./http-client-transport.js";
import { TaskGoalHttpClient } from "./http-client-task-goals.js";

export class TaskCatalogHttpClient extends TaskGoalHttpClient {
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
