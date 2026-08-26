import type {
  AgentFileSearchProvider,
  AgentQueueRepository,
  AgentRuntimeProvider,
  AgentProviderConnectionRepository,
  AgentSettingsRepository,
  ProjectRepository,
  WorkbenchPetProvider,
} from "@codexly/core";
import type {
  AppInfoResponse,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  DeleteProjectFileResponse,
  CreateProjectBranchRequest,
  CreateProjectWorktreeRequest,
  HostFileKind,
  HostFileListing,
  InstallAppUpdateResponse,
  ProjectDirectoryListing,
  ProjectFileTree,
  ProjectGitHistoryPage,
  ProjectGitHistoryQuery,
  ProjectGitCommitFileDiff,
  ProjectGitCommitFileDiffQuery,
  ProjectGitCommitFilesPage,
  ProjectGitCommitFilesQuery,
  ProjectGitStatus,
  ProjectGitStatusQuery,
  ProjectGitWorktree,
  ProjectGitWorktreePage,
  ProjectSourceFile,
  RenameProjectFileResponse,
  SwitchProjectBranchRequest,
  SwitchProjectWorktreeRequest,
} from "@codexly/protocol";

import type { CodexlyAccessOptions } from "./access-control.js";
import type { HostAttachmentSource } from "./host-file-browser.js";
import type { ProjectImageFile } from "./project-image-file.js";
import type { ProjectOpenService } from "./project-open.js";

export interface CreateCodexlyServerOptions {
  access?: CodexlyAccessOptions;
  allowedHosts?: readonly string[];
  eventBufferSize?: number;
  eventSessionId?: string;
  handlerTimeoutMs?: number;
  idempotencyCacheSize?: number;
  idempotencyTtlMs?: number;
  installAppUpdate: (version: string) => Promise<InstallAppUpdateResponse>;
  loggerEnabled?: boolean;
  logDestination?: Readonly<{ write: (message: string) => void }>;
  modelCatalogCacheMaxBytes?: number;
  modelCatalogCacheTtlMs?: number;
  projectRepository: ProjectRepository;
  queueRepository?: AgentQueueRepository;
  providerConnectionRepository: AgentProviderConnectionRepository;
  projectOpenService?: ProjectOpenService;
  projectRuntimeCleanupIntervalMs?: number;
  projectRuntimeIdleTtlMs?: number;
  provider: AgentRuntimeProvider;
  petProvider: WorkbenchPetProvider;
  readAppInfo: () => Promise<AppInfoResponse>;
  settingsRepository: AgentSettingsRepository;
  temporaryWorkspace: string;
  commitProjectChanges?: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  createProjectBranch?: (
    projectRoot: string,
    request: CreateProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  createProjectWorktree?: (
    projectRoot: string,
    request: CreateProjectWorktreeRequest,
  ) => Promise<ProjectGitWorktree>;
  readProjectWorktrees?: (projectRoot: string) => Promise<ProjectGitWorktreePage>;
  resolveProjectWorktree?: (
    projectRoot: string,
    path: SwitchProjectWorktreeRequest["path"],
  ) => Promise<ProjectGitWorktree>;
  readProjectGitStatus?: (
    projectRoot: string,
    query?: Omit<ProjectGitStatusQuery, "rootPath">,
  ) => Promise<ProjectGitStatus>;
  readProjectGitHistory?: (
    projectRoot: string,
    query: Omit<ProjectGitHistoryQuery, "rootPath">,
  ) => Promise<ProjectGitHistoryPage>;
  readProjectGitCommitFiles?: (
    projectRoot: string,
    query: Omit<ProjectGitCommitFilesQuery, "rootPath">,
  ) => Promise<ProjectGitCommitFilesPage>;
  readProjectGitCommitFileDiff?: (
    projectRoot: string,
    query: Omit<ProjectGitCommitFileDiffQuery, "rootPath">,
  ) => Promise<ProjectGitCommitFileDiff>;
  switchProjectBranch?: (
    projectRoot: string,
    request: SwitchProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  readHostFileDirectory?: (kind: HostFileKind, path?: string) => Promise<HostFileListing>;
  readProjectFileTree?: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  deleteProjectFile?: (projectRoot: string, path: string) => Promise<DeleteProjectFileResponse>;
  renameProjectFile?: (
    projectRoot: string,
    path: string,
    name: string,
  ) => Promise<RenameProjectFileResponse>;
  searchProjectFiles?: AgentFileSearchProvider["search"];
  stopProjectFileSearch?: AgentFileSearchProvider["stop"];
  readProjectDirectory?: (
    path?: string,
    options?: Readonly<{ includeHidden?: boolean }>,
  ) => Promise<ProjectDirectoryListing>;
  readProjectImageFile?: (projectRoot: string, path: string) => Promise<ProjectImageFile>;
  readProjectSourceFile?: (
    projectRoot: string,
    path: string,
    cursor?: number,
  ) => Promise<ProjectSourceFile>;
  resolveProjectDirectory?: (path: string) => Promise<string>;
  resolveHostAttachment?: (kind: HostFileKind, path: string) => Promise<HostAttachmentSource>;
  staticRoot?: string;
}
