import {
  AddProjectResponseSchema,
  AgentMcpServerPageSchema,
  AgentMutationErrorSchema,
  AgentProjectDefaultsResponseSchema,
  AgentSkillPageSchema,
  CommitProjectChangesResponseSchema,
  DeleteProjectFileResponseSchema,
  type CreateProjectBranchRequest,
  type CreateProjectWorktreeRequest,
  GenerateCommitMessageResponseSchema,
  HostFileListingSchema,
  OpenProjectResponseSchema,
  ProjectDirectoryListingSchema,
  ProjectFileTreeSchema,
  ProjectFileSearchPageSchema,
  ProjectGitHistoryPageSchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitStatusSchema,
  ProjectGitWorktreePageSchema,
  ProjectWorktreeMutationResponseSchema,
  ProjectOpenCapabilitiesResponseSchema,
  ProjectPageSchema,
  ProjectSourceFileSchema,
  StopProjectFileSearchResponseSchema,
  RemoveProjectResponseSchema,
  ReloadAgentMcpServersResponseSchema,
  RenameProjectResponseSchema,
  RenameProjectFileResponseSchema,
  ReorderProjectsResponseSchema,
  type AddProjectResponse,
  type AgentMcpServerPage,
  type AgentProjectDefaults,
  type AgentProjectDefaultsResponse,
  type AgentSkillPage,
  type CommitProjectChangesRequest,
  type CommitProjectChangesResponse,
  type DeleteProjectFileRequest,
  type DeleteProjectFileResponse,
  type GenerateCommitMessageRequest,
  type GenerateCommitMessageResponse,
  type HostFileKind,
  type HostFileListing,
  type OpenProjectRequest,
  type OpenProjectResponse,
  type ProjectDirectoryListing,
  type ProjectFileTree,
  type ProjectFileSearchPage,
  type ProjectGitHistoryPage,
  type ProjectGitHistoryQuery,
  type ProjectGitCommitFileDiff,
  type ProjectGitCommitFileDiffQuery,
  type ProjectGitCommitFilesPage,
  type ProjectGitCommitFilesQuery,
  type ProjectGitStatus,
  type ProjectGitStatusQuery,
  type ProjectGitWorktreePage,
  type ProjectOpenCapabilitiesResponse,
  type ProjectPage,
  type ProjectSourceFile,
  type StopProjectFileSearchResponse,
  type SwitchProjectBranchRequest,
  type SwitchProjectWorktreeRequest,
  type ProjectWorktreeMutationResponse,
  type RemoveProjectResponse,
  type RenameProjectResponse,
  type RenameProjectFileRequest,
  type RenameProjectFileResponse,
  type ReloadAgentMcpServersResponse,
  type ReorderProjectsResponse,
} from "@codexly/protocol";

import {
  appendQuery,
  projectPath,
  taskPath,
  type MutationOptions,
  type ReadOptions,
} from "./http-client-transport.js";
import { SkillMarketHttpClient } from "./http-client-skill-market.js";

export type ListFilesystemEntriesOptions = ReadOptions &
  Readonly<{
    includeHidden?: boolean;
  }>;

export class ProjectHttpClient extends SkillMarketHttpClient {
  public async listSkills(projectId: string, options: ReadOptions = {}): Promise<AgentSkillPage> {
    return this.read(`${projectPath(projectId)}/skills`, AgentSkillPageSchema, options);
  }

  public async listMcpServers(
    projectId: string,
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.read(
      `${taskPath(projectId, taskId)}/mcp-servers`,
      AgentMcpServerPageSchema,
      options,
      AgentMutationErrorSchema,
    );
  }

  public async retryMcpServers(
    projectId: string,
    taskId: string,
    options: MutationOptions = {},
  ): Promise<ReloadAgentMcpServersResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/mcp-servers/retry`,
      {},
      ReloadAgentMcpServersResponseSchema,
      options,
    );
  }

  public async listProjects(options: ReadOptions = {}): Promise<ProjectPage> {
    return this.read("/v1/projects", ProjectPageSchema, options);
  }

  public async listProjectDirectories(
    path?: string,
    options: ListFilesystemEntriesOptions = {},
  ): Promise<ProjectDirectoryListing> {
    return this.read(
      appendQuery("/v1/project-directories", {
        path,
        includeHidden: options.includeHidden === true ? "true" : undefined,
      }),
      ProjectDirectoryListingSchema,
      options,
    );
  }

  public async listHostFiles(
    kind: HostFileKind,
    path?: string,
    options: ListFilesystemEntriesOptions = {},
  ): Promise<HostFileListing> {
    return this.read(
      appendQuery("/v1/host-files", {
        kind,
        path,
        includeHidden: options.includeHidden === true ? "true" : undefined,
      }),
      HostFileListingSchema,
      options,
    );
  }

  public async reorderProjects(
    projectIds: readonly string[],
    options: MutationOptions = {},
  ): Promise<ReorderProjectsResponse> {
    return this.mutation(
      "/v1/projects/order",
      { projectIds },
      ReorderProjectsResponseSchema,
      options,
      "PUT",
    );
  }

  public async getProjectDefaults(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.read(
      `${projectPath(projectId)}/defaults`,
      AgentProjectDefaultsResponseSchema,
      options,
    );
  }

  public async updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    options: MutationOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.mutation(
      `${projectPath(projectId)}/defaults`,
      settings,
      AgentProjectDefaultsResponseSchema,
      options,
      "PUT",
    );
  }

  public async addProject(
    rootPaths: readonly string[],
    options: MutationOptions = {},
  ): Promise<AddProjectResponse> {
    return this.mutation(
      "/v1/projects",
      { roots: rootPaths.map((path) => ({ path })) },
      AddProjectResponseSchema,
      options,
    );
  }

  public async renameProject(
    projectId: string,
    name: string,
    options: MutationOptions = {},
  ): Promise<RenameProjectResponse> {
    return this.mutation(
      `${projectPath(projectId)}/rename`,
      { name },
      RenameProjectResponseSchema,
      options,
    );
  }

  public async removeProject(
    projectId: string,
    options: MutationOptions = {},
  ): Promise<RemoveProjectResponse> {
    return this.mutation(
      `${projectPath(projectId)}/remove`,
      {},
      RemoveProjectResponseSchema,
      options,
    );
  }

  public async getProjectOpenCapabilities(
    projectId: string,
    options: ReadOptions = {},
  ): Promise<ProjectOpenCapabilitiesResponse> {
    return this.read(
      `${projectPath(projectId)}/open-capabilities`,
      ProjectOpenCapabilitiesResponseSchema,
      options,
    );
  }

  public async openProject(
    projectId: string,
    rootPath: string | undefined,
    request: OpenProjectRequest,
    options: MutationOptions = {},
  ): Promise<OpenProjectResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/open`, { rootPath }),
      request,
      OpenProjectResponseSchema,
      options,
    );
  }

  public async getProjectGitStatus(
    projectId: string,
    query: ProjectGitStatusQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.read(
      appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/git/status`, {
        includeDiff: query.includeDiff === true ? "true" : undefined,
        repository: query.repository,
        rootPath: query.rootPath,
      }),
      ProjectGitStatusSchema,
      options,
    );
  }

  public async getProjectGitHistory(
    projectId: string,
    query: ProjectGitHistoryQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitHistoryPage> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/history`, {
        cursor: query.cursor,
        repository: query.repository,
        rootPath: query.rootPath,
      }),
      ProjectGitHistoryPageSchema,
      options,
    );
  }

  public async getProjectGitCommitFiles(
    projectId: string,
    query: ProjectGitCommitFilesQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitCommitFilesPage> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/commit-files`, {
        cursor: query.cursor,
        repository: query.repository,
        rootPath: query.rootPath,
        sha: query.sha,
      }),
      ProjectGitCommitFilesPageSchema,
      options,
    );
  }

  public async getProjectGitCommitFileDiff(
    projectId: string,
    query: ProjectGitCommitFileDiffQuery,
    options: ReadOptions = {},
  ): Promise<ProjectGitCommitFileDiff> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/commit-diff`, {
        path: query.path,
        repository: query.repository,
        rootPath: query.rootPath,
        sha: query.sha,
      }),
      ProjectGitCommitFileDiffSchema,
      options,
    );
  }

  public async switchProjectBranch(
    projectId: string,
    rootPath: string,
    request: SwitchProjectBranchRequest,
    options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/branch`, { rootPath }),
      request,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async createProjectBranch(
    projectId: string,
    rootPath: string,
    request: CreateProjectBranchRequest,
    options: MutationOptions = {},
  ): Promise<ProjectGitStatus> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/branches`, { rootPath }),
      request,
      ProjectGitStatusSchema,
      options,
    );
  }

  public async listProjectWorktrees(
    projectId: string,
    rootPath: string,
    options: ReadOptions = {},
  ): Promise<ProjectGitWorktreePage> {
    return this.read(
      appendQuery(`${projectPath(projectId)}/git/worktrees`, { rootPath }),
      ProjectGitWorktreePageSchema,
      options,
    );
  }

  public async createProjectWorktree(
    projectId: string,
    rootPath: string,
    request: CreateProjectWorktreeRequest,
    options: MutationOptions = {},
  ): Promise<ProjectWorktreeMutationResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/worktrees`, { rootPath }),
      request,
      ProjectWorktreeMutationResponseSchema,
      options,
    );
  }

  public async switchProjectWorktree(
    projectId: string,
    rootPath: string,
    request: SwitchProjectWorktreeRequest,
    options: MutationOptions = {},
  ): Promise<ProjectWorktreeMutationResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/worktree`, { rootPath }),
      request,
      ProjectWorktreeMutationResponseSchema,
      options,
    );
  }

  public async generateCommitMessage(
    projectId: string,
    rootPath: string,
    request: GenerateCommitMessageRequest,
    options: MutationOptions = {},
  ): Promise<GenerateCommitMessageResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/commit-message`, { rootPath }),
      request,
      GenerateCommitMessageResponseSchema,
      options,
    );
  }

  public async commitProjectChanges(
    projectId: string,
    rootPath: string,
    request: CommitProjectChangesRequest,
    options: MutationOptions = {},
  ): Promise<CommitProjectChangesResponse> {
    return this.mutation(
      appendQuery(`${projectPath(projectId)}/git/commits`, { rootPath }),
      request,
      CommitProjectChangesResponseSchema,
      options,
    );
  }

  public async listProjectFiles(
    projectId: string,
    rootPath: string,
    directoryPath: string | null,
    options: ReadOptions = {},
  ): Promise<ProjectFileTree> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/tree`, {
      path: directoryPath ?? undefined,
      rootPath,
    });
    return this.read(requestPath, ProjectFileTreeSchema, options);
  }

  public async renameProjectFile(
    projectId: string,
    rootPath: string,
    request: RenameProjectFileRequest,
    options: MutationOptions = {},
  ): Promise<RenameProjectFileResponse> {
    return this.mutation(
      appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/rename`, { rootPath }),
      request,
      RenameProjectFileResponseSchema,
      options,
    );
  }

  public async deleteProjectFile(
    projectId: string,
    rootPath: string,
    request: DeleteProjectFileRequest,
    options: MutationOptions = {},
  ): Promise<DeleteProjectFileResponse> {
    return this.mutation(
      appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/delete`, { rootPath }),
      request,
      DeleteProjectFileResponseSchema,
      options,
    );
  }

  public async searchProjectFiles(
    projectId: string,
    rootPath: string,
    query: string,
    sessionId: string,
    options: ReadOptions = {},
  ): Promise<ProjectFileSearchPage> {
    const requestPath = appendQuery(`/v1/projects/${encodeURIComponent(projectId)}/files/search`, {
      query,
      rootPath,
      sessionId,
    });
    return this.read(requestPath, ProjectFileSearchPageSchema, options);
  }

  public async stopProjectFileSearch(
    projectId: string,
    rootPath: string,
    sessionId: string,
    options: MutationOptions = {},
  ): Promise<StopProjectFileSearchResponse> {
    return this.mutation(
      `/v1/projects/${encodeURIComponent(projectId)}/files/search/stop`,
      { rootPath, sessionId },
      StopProjectFileSearchResponseSchema,
      options,
    );
  }

  public async readProjectSourceFile(
    projectId: string,
    rootPath: string | undefined,
    path: string,
    cursor?: number,
    options: ReadOptions = {},
  ): Promise<ProjectSourceFile> {
    const requestPath = appendQuery(`${projectPath(projectId)}/files/source`, {
      cursor,
      path,
      rootPath,
    });
    return this.read(requestPath, ProjectSourceFileSchema, options);
  }
}
