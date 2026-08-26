import type {
  AgentAttachment,
  AgentCapabilities,
  AgentGlobalSettings,
  AgentMessageAttachment,
  AgentModel,
  AgentPromptInput,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTurn,
  AgentTurnOptions,
  EventCheckpoint,
  ProjectGitStatus,
  ProjectFileSearchEntry,
  ProjectRoot,
} from "@codexly/protocol";
import type { Ref } from "react";

import type {
  BrowserPromptInputAttachment,
  PromptInputAttachment,
} from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodexlyMutationClient } from "../../projects/project-queries.js";
import type {
  CodexlyGitMutationClient,
  CodexlyProjectFileSearchClient,
} from "../../projects/project-query-contracts.js";

export type ComposerMode = "goal" | "plan";

export function createComposerTurnOptions(
  settings: AgentTaskSettings,
  model: string,
  reasoningEffort: string | undefined,
  mode: ComposerMode | undefined,
  fastMode: boolean,
): AgentTurnOptions {
  return {
    ...settings,
    ...(mode === "plan" ? { collaborationMode: "plan" as const } : {}),
    ...(mode === "goal" ? { goalMode: true as const } : {}),
    ...(fastMode ? { fastMode: true as const } : {}),
    model,
    reasoningEffort: reasoningEffort ?? settings.reasoningEffort,
  };
}

export type WorkbenchComposerHandle = Readonly<{
  buildPlan: () => Promise<boolean>;
  referenceProjectPath: (file: ProjectFileSearchEntry) => void;
}>;

export type WorkbenchComposerProps = Readonly<{
  composerRef?: Ref<WorkbenchComposerHandle>;
  capabilities: AgentCapabilities | undefined;
  client: CodexlyMutationClient &
    Pick<
      CodexlyGitMutationClient,
      | "createProjectBranch"
      | "createProjectWorktree"
      | "listProjectWorktrees"
      | "switchProjectBranch"
      | "switchProjectWorktree"
    > &
    CodexlyProjectFileSearchClient;
  fastModeAvailable: boolean;
  fastModeDefault: boolean;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
    fastMode: boolean,
  ) => Promise<void> | void;
  onFastModeChange: (enabled: boolean, settings: AgentTaskSettings) => Promise<void> | void;
  onRequestNotificationPermission: () => void;
  onOpenProjectPath: () => void;
  onProjectRootChange: (rootId: string) => void;
  onDirectSubmission?: () => void;
  onSubmissionStateChange?: (submitting: boolean) => void;
  onTaskCreated?: (task: AgentTask) => void;
  onTurnStarted?: (
    turn: AgentTurn,
    input: AgentPromptInput,
    messageAttachments: readonly AgentMessageAttachment[],
  ) => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
    messageAttachments?: readonly AgentMessageAttachment[],
    checkpoint?: EventCheckpoint,
  ) => void;
  projectId: string;
  projectPathOpenDisabled: boolean;
  projectPath: string;
  projectToolsEnabled?: boolean;
  projectRoots: readonly ProjectRoot[];
  selectedProjectRootId: string;
  gitStatus?: ProjectGitStatus;
  runtime?: TaskRuntimeView;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId?: string;
}>;

export async function resolvePromptAttachment(
  attachment: PromptInputAttachment,
  uploadBrowserAttachment: (attachment: BrowserPromptInputAttachment) => Promise<AgentAttachment>,
): Promise<AgentAttachment> {
  if (attachment.source === "host") {
    return attachment.attachment;
  }
  return uploadBrowserAttachment(attachment);
}
