import {
  CreateTaskWorktreeResponseSchema,
  type CreateProjectWorktreeRequest,
} from "@codexly/protocol";

import { appendQuery, projectPath, type MutationOptions } from "./http-client-transport.js";
import { SkillMarketHttpClient } from "./http-client-skill-market.js";

export class TaskWorktreeHttpClient extends SkillMarketHttpClient {
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
