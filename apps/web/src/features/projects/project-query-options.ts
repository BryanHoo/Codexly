import type { CodeAgentClient } from "@code-agent/client";
import type {
  AgentGlobalSettings,
  AgentMcpServerPage,
  AgentProjectDefaults,
  AgentTaskSettings,
  CommitProjectChangesRequest,
  GenerateCommitMessageRequest,
  ProjectGitHistoryPage,
  ProjectGitCommitFilesPage,
} from "@code-agent/protocol";
import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/react-query";

import {
  codeAgentClient,
  type CodeAgentCapabilitiesClient,
  type CodeAgentAppUpdateClient,
  type CodeAgentModelsClient,
  type CodeAgentSettingsClient,
  type CodeAgentSkillsClient,
  type CodeAgentMcpServersClient,
  type CodeAgentMcpServersMutationClient,
  type CodeAgentGitStatusClient,
  type CodeAgentGitHistoryClient,
  type CodeAgentGitCommitReviewClient,
  type CodeAgentFileTreeClient,
  type CodeAgentProjectOpenClient,
  type CodeAgentReadClient,
} from "./project-query-contracts.js";

type TaskPinMutationInput = Readonly<{
  pinned: boolean;
  projectId: string;
  taskId: string;
}>;

type TaskRenameMutationInput = Readonly<{
  projectId: string;
  taskId: string;
  title: string;
}>;

type TaskArchiveMutationInput = Readonly<{ projectId: string; taskId: string }>;
type ProjectRenameMutationInput = Readonly<{ name: string; projectId: string }>;

export function taskPinMutationOptions(client: Pick<CodeAgentClient, "pinTask"> = codeAgentClient) {
  return mutationOptions({
    mutationFn: ({ pinned, projectId, taskId }: TaskPinMutationInput) =>
      client.pinTask(projectId, taskId, pinned),
    mutationKey: ["tasks", "pin"] as const,
  });
}

export function taskRenameMutationOptions(
  client: Pick<CodeAgentClient, "renameTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId, title }: TaskRenameMutationInput) =>
      client.renameTask(projectId, taskId, title),
    mutationKey: ["tasks", "rename"] as const,
  });
}

export function taskArchiveMutationOptions(
  client: Pick<CodeAgentClient, "archiveTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId }: TaskArchiveMutationInput) =>
      client.archiveTask(projectId, taskId),
    mutationKey: ["tasks", "archive"] as const,
  });
}

export function taskUnarchiveMutationOptions(
  client: Pick<CodeAgentClient, "unarchiveTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId }: TaskArchiveMutationInput) =>
      client.unarchiveTask(projectId, taskId),
    mutationKey: ["tasks", "unarchive"] as const,
  });
}

export function taskDeleteMutationOptions(
  client: Pick<CodeAgentClient, "deleteTask"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ projectId, taskId }: TaskArchiveMutationInput) =>
      client.deleteTask(projectId, taskId),
    mutationKey: ["tasks", "delete"] as const,
  });
}

export function projectRenameMutationOptions(
  client: Pick<CodeAgentClient, "renameProject"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: ({ name, projectId }: ProjectRenameMutationInput) =>
      client.renameProject(projectId, name),
    mutationKey: ["projects", "rename"] as const,
    scope: { id: "projects:actions" },
  });
}

export function projectRemoveMutationOptions(
  client: Pick<CodeAgentClient, "removeProject"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (projectId: string) => client.removeProject(projectId),
    mutationKey: ["projects", "remove"] as const,
    scope: { id: "projects:actions" },
  });
}

export function capabilitiesQueryOptions(client: CodeAgentCapabilitiesClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getCapabilities({ signal }),
    queryKey: ["capabilities"] as const,
  });
}

export function modelsQueryOptions(client: CodeAgentModelsClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.listModels({ signal }),
    queryKey: ["models"] as const,
    staleTime: 5 * 60_000,
  });
}

export function appInfoQueryOptions(client: CodeAgentAppUpdateClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getAppInfo({ signal }),
    queryKey: ["app-info"] as const,
    staleTime: 5 * 60_000,
  });
}

export function appUpdateMutationOptions(client: CodeAgentAppUpdateClient = codeAgentClient) {
  return mutationOptions({
    mutationFn: (version: string) => client.installAppUpdate(version),
    mutationKey: ["app-update", "install"] as const,
    scope: { id: "app-update" },
  });
}

export function globalSettingsQueryOptions(client: CodeAgentSettingsClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getGlobalSettings({ signal }),
    queryKey: ["settings"] as const,
  });
}

export function globalSettingsMutationOptions(client: CodeAgentSettingsClient = codeAgentClient) {
  return mutationOptions({
    mutationFn: (settings: AgentGlobalSettings) => client.updateGlobalSettings(settings),
    mutationKey: ["settings", "update"] as const,
    scope: { id: "global-settings" },
  });
}

export function projectOpenCapabilitiesQueryOptions(
  projectId: string,
  client: CodeAgentProjectOpenClient = codeAgentClient,
  enabled = true,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => client.getProjectOpenCapabilities(projectId, { signal }),
    queryKey: ["projects", projectId, "open-capabilities"] as const,
    staleTime: 60_000,
  });
}

export function skillsQueryOptions(
  projectId: string,
  client: CodeAgentSkillsClient = codeAgentClient,
  enabled = true,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => client.listSkills(projectId, { signal }),
    queryKey: ["projects", projectId, "skills"] as const,
  });
}

export function mcpServersQueryOptions(
  projectId: string,
  taskId: string | undefined,
  client: CodeAgentMcpServersClient = codeAgentClient,
  enabled = true,
) {
  return queryOptions<AgentMcpServerPage>({
    enabled: enabled && taskId !== undefined,
    queryFn: async ({ signal }): Promise<AgentMcpServerPage> => {
      if (taskId === undefined) {
        return { data: [] };
      }
      return client.listMcpServers(projectId, taskId, { signal });
    },
    queryKey: ["projects", projectId, "tasks", taskId ?? null, "mcp-servers"] as const,
  });
}

export function mcpServersReloadMutationOptions(
  projectId: string,
  taskId: string | undefined,
  client: CodeAgentMcpServersMutationClient = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: async (): Promise<AgentMcpServerPage> => {
      if (taskId === undefined) {
        throw new Error("Cannot reload MCP servers without a task");
      }
      return client.retryMcpServers(projectId, taskId);
    },
    mutationKey: ["projects", projectId, "tasks", taskId ?? null, "mcp-servers", "reload"] as const,
    scope: { id: `task-mcp:${projectId}:${taskId ?? "none"}` },
  });
}

export function projectDefaultsQueryOptions(
  projectId: string,
  client: Pick<CodeAgentClient, "getProjectDefaults"> = codeAgentClient,
  enabled = true,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => client.getProjectDefaults(projectId, { signal }),
    queryKey: ["projects", projectId, "defaults"] as const,
  });
}

export function projectDefaultsMutationOptions(
  projectId: string,
  client: Pick<CodeAgentClient, "updateProjectDefaults"> = codeAgentClient,
) {
  return mutationOptions({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (settings: AgentProjectDefaults) =>
      client.updateProjectDefaults(projectId, settings),
    mutationKey: ["projects", projectId, "defaults", "update"] as const,
    scope: { id: `project-defaults:${projectId}` },
  });
}

export function taskSettingsMutationOptions(
  projectId: string,
  taskId: string,
  client: Pick<CodeAgentClient, "updateTaskSettings"> = codeAgentClient,
) {
  return mutationOptions({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (settings: AgentTaskSettings) =>
      client.updateTaskSettings(projectId, taskId, settings),
    mutationKey: ["projects", projectId, "tasks", taskId, "settings", "update"] as const,
    scope: { id: `task-settings:${projectId}:${taskId}` },
  });
}

export function projectsQueryOptions(client: CodeAgentReadClient = codeAgentClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.listProjects({ signal }),
    queryKey: ["projects"] as const,
  });
}

export function projectReorderMutationOptions(
  client: Pick<CodeAgentClient, "reorderProjects"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (projectIds: readonly string[]) => client.reorderProjects(projectIds),
    mutationKey: ["projects", "reorder"] as const,
    scope: { id: "projects:reorder" },
  });
}

export function projectGitStatusQueryOptions(
  projectId: string,
  rootPath: string,
  client: CodeAgentGitStatusClient = codeAgentClient,
  enabled = true,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => client.getProjectGitStatus(projectId, { rootPath }, { signal }),
    queryKey: ["projects", projectId, rootPath, "git-status"] as const,
    // Project 级协调器负责刷新生命周期，Query 只维护共享服务端状态。
    retry: 1,
  });
}

export function projectGitDetailedStatusQueryOptions(
  projectId: string,
  rootPath: string,
  repository: string | null,
  snapshot: string,
  enabled: boolean,
  client: CodeAgentGitStatusClient = codeAgentClient,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) =>
      client.getProjectGitStatus(
        projectId,
        {
          includeDiff: true,
          rootPath,
          ...(repository === null ? {} : { repository }),
        },
        { signal },
      ),
    // 详情只服务触发它的仓库快照，状态变化后不会复用旧 Diff。
    queryKey: ["projects", projectId, rootPath, "git-status-detail", repository, snapshot] as const,
    retry: 1,
  });
}

export function projectGitRepositoryStatusQueryOptions(
  projectId: string,
  rootPath: string,
  repository: string | null,
  enabled: boolean,
  client: CodeAgentGitStatusClient = codeAgentClient,
) {
  return queryOptions({
    enabled: enabled && repository !== null,
    queryFn: ({ signal }) =>
      repository === null
        ? Promise.reject(new Error("Git repository is not selected"))
        : client.getProjectGitStatus(
            projectId,
            { includeDiff: true, repository, rootPath },
            { signal },
          ),
    queryKey: ["projects", projectId, rootPath, "git-status", repository] as const,
    retry: 1,
  });
}

export function projectGitHistoryInfiniteQueryOptions(
  projectId: string,
  rootPath: string,
  repository: string | undefined,
  enabled: boolean,
  client: CodeAgentGitHistoryClient = codeAgentClient,
) {
  return infiniteQueryOptions<
    ProjectGitHistoryPage,
    Error,
    { pageParams: (string | undefined)[]; pages: ProjectGitHistoryPage[] },
    readonly ["projects", string, string, "git-history", string | null],
    string | undefined
  >({
    enabled,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam
        ? undefined
        : lastPage.nextCursor,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      client.getProjectGitHistory(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          ...(repository === undefined ? {} : { repository }),
          rootPath,
        },
        { signal },
      ),
    queryKey: ["projects", projectId, rootPath, "git-history", repository ?? null] as const,
  });
}

export function projectGitCommitFilesInfiniteQueryOptions(
  projectId: string,
  rootPath: string,
  repository: string | undefined,
  sha: string,
  enabled: boolean,
  client: CodeAgentGitCommitReviewClient = codeAgentClient,
) {
  return infiniteQueryOptions<
    ProjectGitCommitFilesPage,
    Error,
    { pageParams: (string | undefined)[]; pages: ProjectGitCommitFilesPage[] },
    readonly ["projects", string, string, "git-commit-files", string | null, string],
    string | undefined
  >({
    enabled,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam
        ? undefined
        : lastPage.nextCursor,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) =>
      client.getProjectGitCommitFiles(
        projectId,
        {
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
          ...(repository === undefined ? {} : { repository }),
          rootPath,
          sha,
        },
        { signal },
      ),
    queryKey: [
      "projects",
      projectId,
      rootPath,
      "git-commit-files",
      repository ?? null,
      sha,
    ] as const,
  });
}

export function projectGitCommitFileDiffQueryOptions(
  projectId: string,
  rootPath: string,
  repository: string | undefined,
  sha: string,
  path: string,
  enabled: boolean,
  client: CodeAgentGitCommitReviewClient = codeAgentClient,
) {
  return queryOptions({
    enabled,
    gcTime: 30_000,
    queryFn: ({ signal }) =>
      client.getProjectGitCommitFileDiff(
        projectId,
        {
          path,
          ...(repository === undefined ? {} : { repository }),
          rootPath,
          sha,
        },
        { signal },
      ),
    queryKey: [
      "projects",
      projectId,
      rootPath,
      "git-commit-diff",
      repository ?? null,
      sha,
      path,
    ] as const,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function projectCommitMessageMutationOptions(
  projectId: string,
  rootPath: string,
  client: Pick<CodeAgentClient, "generateCommitMessage"> = codeAgentClient,
) {
  return mutationOptions({
    // 生成结果会直接回填提交信息，仅失败时需要额外通知。
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (request: GenerateCommitMessageRequest) =>
      client.generateCommitMessage(projectId, rootPath, request),
    mutationKey: ["projects", projectId, rootPath, "git", "commit-message"] as const,
    scope: { id: `project-git-message:${projectId}:${rootPath}` },
  });
}

export function projectCommitChangesMutationOptions(
  projectId: string,
  rootPath: string,
  client: Pick<CodeAgentClient, "commitProjectChanges"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (request: CommitProjectChangesRequest) =>
      client.commitProjectChanges(projectId, rootPath, request),
    mutationKey: ["projects", projectId, rootPath, "git", "commit"] as const,
    scope: { id: `project-git-mutation:${projectId}:${rootPath}` },
  });
}

export function projectFileTreeQueryOptions(
  projectId: string,
  rootPath: string,
  directoryPath: string | null,
  client: CodeAgentFileTreeClient = codeAgentClient,
  enabled = true,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) =>
      client.listProjectFiles(projectId, rootPath, directoryPath, { signal }),
    queryKey: ["projects", projectId, rootPath, "file-tree", directoryPath] as const,
    staleTime: 30_000,
  });
}
