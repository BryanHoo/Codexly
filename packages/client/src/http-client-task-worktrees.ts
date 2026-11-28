import {
  CreateTaskWorktreeResponseSchema,
  type CreateProjectWorktreeRequest,
} from "@codexly/protocol";

import { appendQuery, projectPath, type MutationOptions } from "./http-client-transport.js";
import { EngineHttpClient } from "./http-client-engines.js";

export class TaskWorktreeHttpClient extends EngineHttpClient {
  public async createTaskWorktree(
    projectId: string,
    rootPath: string,
    request: CreateProjectWorktreeRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/task-worktrees`, { rootPath }),
      request,
      CreateTaskWorktreeResponseSchema,
      options,
    );
  }
}
