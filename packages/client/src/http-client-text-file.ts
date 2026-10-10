import {
  ProjectTextFileSchema,
  SaveProjectTextFileResponseSchema,
  type ProjectTextFile,
  type SaveProjectTextFileRequest,
  type SaveProjectTextFileResponse,
} from "@codexly/protocol";

import {
  appendQuery,
  projectPath,
  type ReadOptions,
  type MutationOptions,
} from "./http-client-transport.js";
import { ProjectDirectoryHttpClient } from "./http-client-project-directory.js";

export class ProjectTextFileHttpClient extends ProjectDirectoryHttpClient {
  public async readProjectTextFile(
    projectId: string,
    rootPath: string | undefined,
    path: string,
    options: ReadOptions = {},
  ): Promise<ProjectTextFile> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/files/text`, { path, rootPath }),
      ProjectTextFileSchema,
      options,
    );
  }

  public async saveProjectTextFile(
    projectId: string,
    rootPath: string | undefined,
    input: SaveProjectTextFileRequest,
    options: MutationOptions = {},
  ): Promise<SaveProjectTextFileResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/files/text`, { rootPath }),
      input,
      SaveProjectTextFileResponseSchema,
      options,
    );
  }
}
