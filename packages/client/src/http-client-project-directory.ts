import {
  CreateProjectDirectoryResponseSchema,
  type CreateProjectDirectoryRequest,
} from "@codexly/protocol";
import type { MutationOptions } from "./http-client-transport.js";
import { TaskWorktreeHttpClient } from "./http-client-task-worktrees.js";

export class ProjectDirectoryHttpClient extends TaskWorktreeHttpClient {
  public async createProjectDirectory(
    request: CreateProjectDirectoryRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      "/v1/project-directories",
      request,
      CreateProjectDirectoryResponseSchema,
      options,
    );
  }
}
