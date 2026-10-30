import {
  CreateProjectFileResponseSchema,
  type CreateProjectFileRequest,
  type CreateProjectFileResponse,
} from "@codexly/protocol";
import { appendQuery, type MutationOptions } from "./http-client-transport.js";
import { GitPushHttpClient } from "./http-client-git-push.js";
export class FileCreationHttpClient extends GitPushHttpClient {
  public async createProjectFile(
    projectId: string,
    rootPath: string,
    request: CreateProjectFileRequest,
    options: MutationOptions = {},
  ): Promise<CreateProjectFileResponse> {
    return this.mutation(
      appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/create`, { rootPath }),
      request,
      CreateProjectFileResponseSchema,
      options,
    );
  }
}
