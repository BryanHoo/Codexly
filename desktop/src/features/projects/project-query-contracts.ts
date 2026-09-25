import type { NativeClient } from "@/platform/native-client-contract.js";
import type { AgentTaskPage, AgentTaskSnapshot } from "@/protocol/index.js";
import type { InfiniteData } from "@tanstack/react-query";

import { TauriSidebarClient } from "../../platform/tauri/sidebar-client.js";

export type NativeReadClient = Pick<
  NativeClient,
  "listCompletedTasks" | "listProjects" | "listTasks" | "readTask" | "searchTasks" | "searchTaskOccurrences"
>;
export type NativeArchivedTaskClient = Pick<
  NativeClient,
  "deleteTask" | "listTasks" | "unarchiveTask"
>;
export type NativeGitStatusClient = Pick<NativeClient, "getProjectGitStatus">;
export type NativeGitHistoryClient = Pick<NativeClient, "getProjectGitHistory">;
export type NativeGitCommitReviewClient = Pick<
  NativeClient,
  "getProjectGitCommitFileDiff" | "getProjectGitCommitFiles"
>;
export type NativeGitMutationClient = Pick<
  NativeClient,
  | "commitProjectChanges"
  | "createProjectBranch"
  | "createProjectWorktree"
  | "generateCommitMessage"
  | "listProjectWorktrees"
  | "switchProjectBranch"
  | "switchProjectWorktree"
>;
export type NativeFileTreeReadClient = Pick<NativeClient, "listProjectFiles">;
export type NativeFileTreeClient = Pick<
  NativeClient,
  "deleteProjectFile" | "listProjectFiles" | "renameProjectFile"
>;
export type NativeProjectFileSearchClient = Pick<
  NativeClient,
  "searchProjectFiles" | "stopProjectFileSearch"
>;
export type NativeProjectDirectoryClient = Pick<NativeClient, "listProjectDirectories">;
export type NativeHostAttachmentClient = Pick<
  NativeClient,
  "importHostAttachment" | "listHostFiles"
>;
export type NativeSourceFileClient = Pick<
  NativeClient,
  "cacheProjectImage" | "readProjectSourceFile"
>;
export type NativeProjectOpenClient = Pick<
  NativeClient,
  "getProjectOpenCapabilities" | "openProject"
>;
export type NativeRuntimeClient = Pick<
  NativeClient,
  "readTask" | "releaseTaskSubscription" | "retainTaskSubscription" | "subscribeEvents"
>;
export type NativeBackgroundTerminalClient = Pick<
  NativeClient,
  "listBackgroundTerminals" | "terminateBackgroundTerminal"
>;
export type NativeCapabilitiesClient = Pick<NativeClient, "getCapabilities">;
export type NativeModelsClient = Pick<NativeClient, "listModels">;
export type NativeAppUpdateClient = Pick<NativeClient, "getAppInfo" | "installAppUpdate">;
export type NativeDiagnosticsClient = Pick<NativeClient, "exportDiagnostics">;
export type NativeMcpServersClient = Pick<NativeClient, "listMcpServers">;
export type NativeMcpServersMutationClient = Pick<NativeClient, "retryMcpServers">;
export type NativeSkillsClient = Pick<
  NativeClient,
  | "getClawhubSkill"
  | "installClawhubSkill"
  | "listClawhubSkills"
  | "listConfiguredMcpServers"
  | "listInstalledSkills"
  | "listOfficialPlugins"
  | "getOfficialPlugin"
  | "installOfficialPlugin"
  | "uninstallOfficialPlugin"
  | "listSkills"
  | "openSkillDirectory"
  | "setMcpServerEnabled"
  | "setSkillEnabled"
>;
export type NativeSettingsClient = Pick<
  NativeClient,
  | "getGlobalSettings"
  | "getProjectDefaults"
  | "updateGlobalSettings"
  | "updateProjectDefaults"
  | "updateTaskSettings"
>;
export type NativeMutationClient = Pick<
  NativeClient,
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
  | "moveQueuedSubmission"
  | "reorderProjects"
  | "submitReview"
  | "startQueuedSubmission"
  | "startTask"
  | "startTurn"
  | "submitPrompt"
  | "steerTurn"
  | "uploadAttachment"
  | "unarchiveTask"
  | "updateTaskGoal"
>;
export type NativePendingRequestClient = Pick<NativeClient, "resolvePendingRequest">;
export type NativeWorkbenchClient = NativeReadClient &
  NativeScheduledTaskClient &
  NativeBackgroundTerminalClient &
  NativeGitStatusClient &
  NativeGitHistoryClient &
  NativeGitCommitReviewClient &
  NativeGitMutationClient &
  NativeFileTreeClient &
  NativeProjectFileSearchClient &
  NativeProjectDirectoryClient &
  NativeProjectOpenClient &
  NativeRuntimeClient &
  NativeMutationClient &
  NativePendingRequestClient &
  NativeCapabilitiesClient &
  NativeModelsClient &
  NativeAppUpdateClient &
  NativeDiagnosticsClient &
  NativeMcpServersClient &
  NativeMcpServersMutationClient &
  NativeSkillsClient &
  NativeSettingsClient &
  NativeSourceFileClient;
export type NativeSnapshotClient = Pick<NativeClient, "readTask">;
export type NativeScheduledTaskClient = Pick<
  NativeClient,
  | "createScheduledTask"
  | "deleteScheduledTask"
  | "listScheduledTasks"
  | "previewScheduledTask"
  | "runScheduledTaskNow"
  | "setScheduledTaskEnabled"
  | "updateScheduledTask"
>;

export const PROJECT_TASK_PAGE_SIZE = 5;
export const COMPLETED_TASK_PAGE_SIZE = 10;
export const ARCHIVED_TASK_PAGE_SIZE = 20;
export const PROJECT_PINNED_TASK_PAGE_SIZE = 100;
export const PROJECT_PINNED_TASKS_KEY = "pinned";
export const TASK_BOARD_COMPLETED_TASKS_QUERY_KEY = ["task-board", "completed"] as const;
export const TASK_SNAPSHOT_GC_TIME_MS = 30_000;

export function taskQueueQueryKey(projectId: string, taskId: string) {
  return ["projects", projectId, "tasks", taskId, "queue"] as const;
}

// 左栏运行时直接调用 Rust/Tauri，保留现有视图 Client 契约以避免组件交互漂移。
export const nativeClient = new TauriSidebarClient();

export type ProjectTaskInfiniteData = InfiniteData<AgentTaskPage, string | undefined>;
export type TaskTitleSnapshot = Pick<
  AgentTaskSnapshot,
  "id" | "projectId" | "title" | "turns" | "updatedAt"
>;
export type TaskTitleUpdateOptions = Readonly<{
  assistantReplyStarted?: boolean;
}>;
