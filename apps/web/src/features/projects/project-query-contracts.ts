import { CodexlyClient } from "@codexly/client";
import type { AgentTask, AgentTaskPage, AgentTaskSnapshot } from "@codexly/protocol";
import type { InfiniteData } from "@tanstack/react-query";

export type CodexlyReadClient = Pick<CodexlyClient, "listProjects" | "listTasks" | "readTask">;
export type CodexlyArchivedTaskClient = Pick<
  CodexlyClient,
  "deleteTask" | "listTasks" | "unarchiveTask"
>;
export type CodexlyAccessClient = Pick<
  CodexlyClient,
  "getAccessStatus" | "logoutAccess" | "pairAccess" | "subscribeUnauthorized"
>;
export type CodexlyGitStatusClient = Pick<CodexlyClient, "getProjectGitStatus">;
export type CodexlyGitHistoryClient = Pick<CodexlyClient, "getProjectGitHistory">;
export type CodexlyGitCommitReviewClient = Pick<
  CodexlyClient,
  "getProjectGitCommitFileDiff" | "getProjectGitCommitFiles"
>;
export type CodexlyGitMutationClient = Pick<
  CodexlyClient,
  | "commitProjectChanges"
  | "createProjectBranch"
  | "createProjectWorktree"
  | "generateCommitMessage"
  | "listProjectWorktrees"
  | "switchProjectBranch"
  | "switchProjectWorktree"
>;
export type CodexlyFileTreeReadClient = Pick<CodexlyClient, "listProjectFiles">;
export type CodexlyFileTreeClient = Pick<
  CodexlyClient,
  "deleteProjectFile" | "listProjectFiles" | "renameProjectFile"
>;
export type CodexlyProjectFileSearchClient = Pick<
  CodexlyClient,
  "searchProjectFiles" | "stopProjectFileSearch"
>;
export type CodexlyProjectDirectoryClient = Pick<CodexlyClient, "listProjectDirectories">;
export type CodexlyHostAttachmentClient = Pick<
  CodexlyClient,
  "importHostAttachment" | "listHostFiles"
>;
export type CodexlySourceFileClient = Pick<CodexlyClient, "readProjectSourceFile">;
export type CodexlyProjectOpenClient = Pick<
  CodexlyClient,
  "getProjectOpenCapabilities" | "openProject"
>;
export type CodexlyRuntimeClient = Pick<
  CodexlyClient,
  "readTask" | "subscribeEvents" | "unsubscribeTask"
>;
export type CodexlyBackgroundTerminalClient = Pick<
  CodexlyClient,
  "listBackgroundTerminals" | "terminateBackgroundTerminal"
>;
export type CodexlyCapabilitiesClient = Pick<CodexlyClient, "getCapabilities">;
export type CodexlyModelsClient = Pick<CodexlyClient, "listModels">;
export type CodexlyAppUpdateClient = Pick<
  CodexlyClient,
  "getAppInfo" | "getAppUpdateProgress" | "installAppUpdate"
>;
export type CodexlyMcpServersClient = Pick<CodexlyClient, "listMcpServers">;
export type CodexlyMcpServersMutationClient = Pick<CodexlyClient, "retryMcpServers">;
export type CodexlySkillsClient = Pick<CodexlyClient, "listSkills">;
export type CodexlySkillMarketClient = Pick<
  CodexlyClient,
  | "getClawhubSkill"
  | "installClawhubSkill"
  | "listClawhubSkills"
  | "listConfiguredMcpServers"
  | "listInstalledSkills"
  | "openSkillDirectory"
  | "setMcpServerEnabled"
  | "setSkillEnabled"
>;
export type CodexlySettingsClient = Pick<
  CodexlyClient,
  | "getGlobalSettings"
  | "getProjectDefaults"
  | "updateGlobalSettings"
  | "updateProjectDefaults"
  | "updateTaskSettings"
>;
export type CodexlyMutationClient = Pick<
  CodexlyClient,
  | "addQueuedSubmission"
  | "addProject"
  | "archiveTask"
  | "compactTask"
  | "clearTaskGoal"
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
  | "updateTaskGoal"
>;
export type CodexlyPendingRequestClient = Pick<CodexlyClient, "resolvePendingRequest">;
export type CodexlyWorkbenchClient = CodexlyReadClient &
  CodexlyBackgroundTerminalClient &
  CodexlyGitStatusClient &
  CodexlyGitHistoryClient &
  CodexlyGitCommitReviewClient &
  CodexlyGitMutationClient &
  CodexlyFileTreeClient &
  CodexlyProjectFileSearchClient &
  CodexlyProjectDirectoryClient &
  CodexlyProjectOpenClient &
  CodexlyRuntimeClient &
  CodexlyMutationClient &
  CodexlyPendingRequestClient &
  CodexlyCapabilitiesClient &
  CodexlyModelsClient &
  CodexlyAppUpdateClient &
  CodexlyMcpServersClient &
  CodexlyMcpServersMutationClient &
  CodexlySkillsClient &
  CodexlySkillMarketClient &
  CodexlySettingsClient &
  CodexlySourceFileClient;
export type CodexlySnapshotClient = Pick<CodexlyClient, "readTask">;

export const PROJECT_TASK_PAGE_SIZE = 5;
export const COMPLETED_TASK_PAGE_SIZE = 10;
export const ARCHIVED_TASK_PAGE_SIZE = 20;
export const PROJECT_TASK_SEARCH_PAGE_SIZE = 100;
export const PROJECT_PINNED_TASKS_KEY = "pinned";
export const PROJECT_TASK_SEARCH_SOURCE_KEY = "search-source";
export const TASK_BOARD_COMPLETED_TASKS_QUERY_KEY = ["task-board", "completed"] as const;
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export function taskQueueQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "queue"] as const;
}

export const codexlyClient = new CodexlyClient();

export type ProjectTaskInfiniteData = InfiniteData<AgentTaskPage, string | undefined>;
export type CompletedTasksCursor = Readonly<Record<string, string | null>>;
export type CompletedTasksPage = Readonly<{
  cursors: CompletedTasksCursor;
  data: readonly AgentTask[];
}>;
export type CompletedTasksInfiniteData = InfiniteData<
  CompletedTasksPage,
  CompletedTasksCursor | undefined
>;
export type TaskTitleSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "turns" | "updatedAt"
>;
export type TaskTitleUpdateOptions = Readonly<{
  assistantReplyStarted?: boolean;
}>;
