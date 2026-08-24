import type {
  AgentFileSearchProvider,
  AgentProvider,
  AgentProviderConnectionRepository,
  AgentProviderTurnInput,
  AgentRuntimeProvider,
  AgentSettingsRepository,
  AgentTaskScope,
  PendingRequestResolutionError,
  ProjectRepository,
} from "@codexly/core";
import type {
  AppInfoResponse,
  AgentAttachmentKind,
  AgentCapabilities,
  AgentGlobalSettings,
  AgentModel,
  AgentModelPage,
  AgentMutationError,
  AgentProjectDefaults,
  AgentPromptInput,
  AgentTask,
  AgentTaskSettings,
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  CreateProjectBranchRequest,
  CreateProjectWorktreeRequest,
  GenerateCommitMessageRequest,
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
  SwitchProjectBranchRequest,
  SwitchProjectWorktreeRequest,
} from "@codexly/protocol";

import type { AgentEventStream } from "../agent-event-stream.js";
import type { AccessSessionService } from "../access-control.js";
import type { AttachmentStore } from "../attachment-store.js";
import type { GitCommitError } from "../git-commit.js";
import type { HostAttachmentSource } from "../host-file-browser.js";
import type { ProjectOpenService } from "../project-open.js";
import type { ProjectImageFile } from "../project-image-file.js";

export class MutationHttpError extends Error {
  public constructor(
    public readonly code: AgentMutationError["code"],
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "MutationHttpError";
  }
}

export function toMcpProviderHttpError(error: unknown): MutationHttpError {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "MCP provider request failed";
  return new MutationHttpError("PROVIDER_ERROR", message, 502, true);
}

export type ProjectRuntimeContext = Readonly<{
  eventStream: AgentEventStream;
  provider: AgentProvider;
  scope: AgentTaskScope;
  transportMetrics: {
    activeClients: number;
    slowClientDisconnects: number;
  };
  unsubscribe: () => void;
}>;

export type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectRuntimeContext | undefined>;

export type RunIdempotent = <T>(
  scope: readonly string[],
  key: string,
  payload: unknown,
  action: () => Promise<T> | T,
) => Promise<T>;

export type TaskStartRecovery = Readonly<{
  fingerprint: string;
  settings: AgentTaskSettings;
  task: AgentTask;
}>;

export interface ServerRouteContext {
  readonly accessService?: AccessSessionService;
  readonly activeGitMutations: Set<string>;
  readonly assertCommitSelection: (
    status: ProjectGitStatus,
    request: GenerateCommitMessageRequest,
  ) => void;
  readonly assertValidProjectDefaults: (
    models: readonly AgentModel[],
    settings: Pick<AgentTaskSettings, "model" | "reasoningEffort" | "sandboxMode">,
  ) => void;
  readonly attachmentStore: AttachmentStore;
  readonly buildCommitMessagePrompt: (
    status: ProjectGitStatus,
    request: GenerateCommitMessageRequest,
    customPrompt: string,
  ) => string;
  readonly capabilities: AgentCapabilities;
  readonly commitProjectChanges: (
    projectRoot: string,
    request: CommitProjectChangesRequest,
  ) => Promise<CommitProjectChangesResponse>;
  readonly generateCommitMessageWithCodex: (
    provider: AgentProvider,
    prompt: string,
    settings: AgentTaskSettings,
  ) => Promise<string>;
  readonly getProjectContext: ProjectContextResolver;
  readonly fingerprintPayload: (payload: unknown) => string;
  readonly idempotencyCacheSize: number;
  readonly installAppUpdate: (version: string) => Promise<InstallAppUpdateResponse>;
  readonly listModels: () => Promise<readonly AgentModel[]>;
  readonly maximumAttachmentBytes: (kind: AgentAttachmentKind) => number;
  readonly modelCatalogCache: Readonly<{
    clear: () => void;
    read: () => Promise<AgentModelPage>;
  }>;
  readonly multipartEnvelopeBytes: number;
  readonly projectOpenService: ProjectOpenService;
  readonly projectContexts: Map<string, ProjectRuntimeContext>;
  readonly projectRepository: ProjectRepository;
  readonly provider: AgentRuntimeProvider;
  readonly providerConnectionRepository: AgentProviderConnectionRepository;
  readonly readEffectiveGlobalSettings: (
    models?: readonly AgentModel[],
  ) => Promise<AgentGlobalSettings>;
  readonly readAppInfo: () => Promise<AppInfoResponse>;
  readonly readEffectiveProjectDefaults: (
    projectId: string,
    models?: readonly AgentModel[],
    globalSettings?: AgentGlobalSettings,
  ) => Promise<AgentProjectDefaults>;
  readonly readInheritedTaskSettings: (
    projectId: string,
    models?: readonly AgentModel[],
  ) => Promise<AgentTaskSettings>;
  readonly readEffectiveTaskSettings: (
    projectId: string,
    taskId: string,
    models?: readonly AgentModel[],
  ) => Promise<AgentTaskSettings>;
  readonly readFileTree: (projectRoot: string, directoryPath?: string) => Promise<ProjectFileTree>;
  readonly searchProjectFiles: AgentFileSearchProvider["search"];
  readonly stopProjectFileSearch: AgentFileSearchProvider["stop"];
  readonly readHostFileDirectory: (
    kind: HostFileKind,
    path?: string,
    options?: Readonly<{ includeHidden?: boolean }>,
  ) => Promise<HostFileListing>;
  readonly readProjectDirectory: (
    path?: string,
    options?: Readonly<{ includeHidden?: boolean }>,
  ) => Promise<ProjectDirectoryListing>;
  readonly readImageFile: (projectRoot: string, path: string) => Promise<ProjectImageFile>;
  readonly readProjectGitStatus: (
    projectRoot: string,
    query?: Omit<ProjectGitStatusQuery, "rootPath">,
  ) => Promise<ProjectGitStatus>;
  readonly createProjectBranch: (
    projectRoot: string,
    request: CreateProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  readonly createProjectWorktree: (
    projectRoot: string,
    request: CreateProjectWorktreeRequest,
  ) => Promise<ProjectGitWorktree>;
  readonly readProjectWorktrees: (projectRoot: string) => Promise<ProjectGitWorktreePage>;
  readonly resolveProjectWorktree: (
    projectRoot: string,
    path: SwitchProjectWorktreeRequest["path"],
  ) => Promise<ProjectGitWorktree>;
  readonly readProjectGitHistory: (
    projectRoot: string,
    query: Omit<ProjectGitHistoryQuery, "rootPath">,
  ) => Promise<ProjectGitHistoryPage>;
  readonly readProjectGitCommitFiles: (
    projectRoot: string,
    query: Omit<ProjectGitCommitFilesQuery, "rootPath">,
  ) => Promise<ProjectGitCommitFilesPage>;
  readonly readProjectGitCommitFileDiff: (
    projectRoot: string,
    query: Omit<ProjectGitCommitFileDiffQuery, "rootPath">,
  ) => Promise<ProjectGitCommitFileDiff>;
  readonly switchProjectBranch: (
    projectRoot: string,
    request: SwitchProjectBranchRequest,
  ) => Promise<ProjectGitStatus>;
  readonly readSourceFile: (
    projectRoot: string,
    path: string,
    cursor?: number,
  ) => Promise<ProjectSourceFile>;
  readonly releaseProjectContext: (projectId: string) => Promise<void>;
  readonly resolveProviderTurnInput: (
    projectId: string,
    input: AgentPromptInput,
    provider?: AgentProvider,
    taskId?: string,
  ) => Promise<
    Readonly<{ attachmentIds: readonly string[]; providerInput: AgentProviderTurnInput }>
  >;
  readonly runIdempotent: RunIdempotent;
  readonly resolveProjectDirectory: (path: string) => Promise<string>;
  readonly resolveHostAttachment: (
    kind: HostFileKind,
    path: string,
  ) => Promise<HostAttachmentSource>;
  readonly settingsRepository: AgentSettingsRepository;
  readonly taskFromSnapshot: (
    snapshot: Awaited<ReturnType<AgentProvider["readTask"]>> & object,
    overrides?: Partial<Pick<AgentTask, "title">>,
  ) => AgentTask;
  readonly taskStartRecoveries: Map<string, TaskStartRecovery>;
  readonly toGitCommitHttpError: (error: GitCommitError) => MutationHttpError;
  readonly toPendingRequestHttpError: (error: PendingRequestResolutionError) => MutationHttpError;
}
