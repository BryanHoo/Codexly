import { CodeAgentClient } from "@code-agent/client";
import type { AgentTaskPage, AgentTaskSnapshot } from "@code-agent/protocol";
import type { InfiniteData } from "@tanstack/react-query";

export type CodeAgentReadClient = Pick<CodeAgentClient, "listProjects" | "listTasks" | "readTask">;
export type CodeAgentArchivedTaskClient = Pick<
  CodeAgentClient,
  "deleteTask" | "listTasks" | "unarchiveTask"
>;
export type CodeAgentAccessClient = Pick<
  CodeAgentClient,
  "getAccessStatus" | "logoutAccess" | "pairAccess" | "subscribeUnauthorized"
>;
export type CodeAgentGitStatusClient = Pick<CodeAgentClient, "getProjectGitStatus">;
export type CodeAgentGitHistoryClient = Pick<CodeAgentClient, "getProjectGitHistory">;
export type CodeAgentGitCommitReviewClient = Pick<
  CodeAgentClient,
  "getProjectGitCommitFileDiff" | "getProjectGitCommitFiles"
>;
export type CodeAgentGitMutationClient = Pick<
  CodeAgentClient,
  | "commitProjectChanges"
  | "createProjectBranch"
  | "createProjectWorktree"
  | "generateCommitMessage"
  | "listProjectWorktrees"
  | "switchProjectBranch"
  | "switchProjectWorktree"
>;
export type CodeAgentFileTreeClient = Pick<CodeAgentClient, "listProjectFiles">;
export type CodeAgentProjectFileSearchClient = Pick<
  CodeAgentClient,
  "searchProjectFiles" | "stopProjectFileSearch"
>;
export type CodeAgentProjectDirectoryClient = Pick<CodeAgentClient, "listProjectDirectories">;
export type CodeAgentHostAttachmentClient = Pick<
  CodeAgentClient,
  "importHostAttachment" | "listHostFiles"
>;
export type CodeAgentSourceFileClient = Pick<CodeAgentClient, "readProjectSourceFile">;
export type CodeAgentProjectOpenClient = Pick<
  CodeAgentClient,
  "getProjectOpenCapabilities" | "openProject"
>;
export type CodeAgentRuntimeClient = Pick<
  CodeAgentClient,
  "readTask" | "subscribeEvents" | "unsubscribeTask"
>;
export type CodeAgentBackgroundTerminalClient = Pick<
  CodeAgentClient,
  "listBackgroundTerminals" | "terminateBackgroundTerminal"
>;
export type CodeAgentCapabilitiesClient = Pick<CodeAgentClient, "getCapabilities">;
export type CodeAgentModelsClient = Pick<CodeAgentClient, "listModels">;
export type CodeAgentAppUpdateClient = Pick<CodeAgentClient, "getAppInfo" | "installAppUpdate">;
export type CodeAgentMcpServersClient = Pick<CodeAgentClient, "listMcpServers">;
export type CodeAgentMcpServersMutationClient = Pick<CodeAgentClient, "retryMcpServers">;
export type CodeAgentSkillsClient = Pick<CodeAgentClient, "listSkills">;
export type CodeAgentSettingsClient = Pick<
  CodeAgentClient,
  | "getGlobalSettings"
  | "getProjectDefaults"
  | "updateGlobalSettings"
  | "updateProjectDefaults"
  | "updateTaskSettings"
>;
export type CodeAgentMutationClient = Pick<
  CodeAgentClient,
  | "addQueuedSubmission"
  | "addProject"
  | "archiveTask"
  | "compactTask"
  | "deleteTask"
  | "deleteQueuedSubmission"
  | "forkTask"
  | "interruptTurn"
  | "importHostAttachment"
  | "getTaskAttachmentUrl"
  | "listHostFiles"
  | "listQueuedSubmissions"
  | "openTaskAttachment"
  | "pinTask"
  | "removeProject"
  | "renameProject"
  | "renameTask"
  | "reorderQueuedSubmissions"
  | "reorderProjects"
  | "startReview"
  | "startQueuedSubmission"
  | "startTask"
  | "startTurn"
  | "steerTurn"
  | "uploadAttachment"
  | "uploadFeedback"
  | "unarchiveTask"
  | "updateQueuedSubmission"
>;
export type CodeAgentPendingRequestClient = Pick<CodeAgentClient, "resolvePendingRequest">;
export type CodeAgentWorkbenchClient = CodeAgentReadClient &
  CodeAgentBackgroundTerminalClient &
  CodeAgentGitStatusClient &
  CodeAgentGitHistoryClient &
  CodeAgentGitCommitReviewClient &
  CodeAgentGitMutationClient &
  CodeAgentFileTreeClient &
  CodeAgentProjectFileSearchClient &
  CodeAgentProjectDirectoryClient &
  CodeAgentProjectOpenClient &
  CodeAgentRuntimeClient &
  CodeAgentMutationClient &
  CodeAgentPendingRequestClient &
  CodeAgentCapabilitiesClient &
  CodeAgentModelsClient &
  CodeAgentAppUpdateClient &
  CodeAgentMcpServersClient &
  CodeAgentMcpServersMutationClient &
  CodeAgentSkillsClient &
  CodeAgentSettingsClient &
  CodeAgentSourceFileClient;
export type CodeAgentSnapshotClient = Pick<CodeAgentClient, "readTask">;

export const PROJECT_TASK_PAGE_SIZE = 5;
export const ARCHIVED_TASK_PAGE_SIZE = 20;
export const PROJECT_TASK_SEARCH_PAGE_SIZE = 100;
export const PROJECT_PINNED_TASKS_KEY = "pinned";
export const PROJECT_TASK_SEARCH_SOURCE_KEY = "search-source";
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export function taskQueueQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "queue"] as const;
}

export const codeAgentClient = new CodeAgentClient();

export type ProjectTaskInfiniteData = InfiniteData<AgentTaskPage, string | undefined>;
export type TaskTitleSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "turns" | "updatedAt"
>;
export type TaskTitleUpdateOptions = Readonly<{
  assistantReplyStarted?: boolean;
}>;
