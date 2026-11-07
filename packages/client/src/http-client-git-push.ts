import {
  ProjectGitStatusSchema,
  type ProjectGitStatus,
  type DiscardProjectChangesRequest,
  PushProjectCommitsResponseSchema,
  type PushProjectCommitsRequest,
  type PushProjectCommitsResponse,
} from "@codexly/protocol";
import { appendQuery, projectPath, type MutationOptions } from "./http-client-transport.js";
import { ProjectTextFileHttpClient } from "./http-client-text-file.js";

export class GitPushHttpClient extends ProjectTextFileHttpClient {
  public async discardProjectChanges(
    projectId: string,
    rootPath: string,
    request: DiscardProjectChangesRequest,
    options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/discard`, { rootPath }),
      request,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async pushProjectCommits(
    projectId: string,
    rootPath: string,
    request: PushProjectCommitsRequest,
    options: MutationOptions = {},
  ): Promise<PushProjectCommitsResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/push`, { rootPath }),
      request,
      PushProjectCommitsResponseSchema,
      options,
    );
  }
}
