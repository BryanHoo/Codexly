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
} from "@/protocol/index.js";
import type { Ref } from "react";

import { buildNativeAssetUrl } from "../../../platform/native-asset-url.js";
import type {
  BrowserPromptInputAttachment,
  PromptInputAttachment,
} from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { ComposerDraft } from "../composer-draft-context.js";
import type { NativeMutationClient } from "../../projects/project-queries.js";
import type {
  NativeGitMutationClient,
  NativeProjectFileSearchClient,
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
  answerQuestions: (text: string) => Promise<boolean>;
  referenceProjectPath: (file: ProjectFileSearchEntry) => void;
  submitCurrent: () => Promise<boolean>;
}>;

export type WorkbenchComposerProps = Readonly<{
  composerRef?: Ref<WorkbenchComposerHandle>;
  capabilities: AgentCapabilities | undefined;
  client: NativeMutationClient &
    Pick<
      NativeGitMutationClient,
      | "createProjectBranch"
      | "createProjectWorktree"
      | "listProjectWorktrees"
      | "switchProjectBranch"
      | "switchProjectWorktree"
    > &
    NativeProjectFileSearchClient;
  fastModeAvailable: boolean;
  fastModeDefault: boolean;
  followUpBehavior: AgentGlobalSettings["followUpBehavior"];
  initialProjectDraftId?: string;
  initialDraft?: ComposerDraft;
  composerDraftId?: string;
  captureSubmitVisible?: boolean;
  captureSubmitLabel?: string;
  footerVisible?: boolean;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
    fastMode: boolean,
  ) => Promise<void> | void;
  onFastModeChange: (enabled: boolean, settings: AgentTaskSettings) => Promise<void> | void;
  onOpenProjectPath: () => void;
  onProjectRootChange: (rootId: string) => void;
  onDirectSubmission?: () => void;
  onCaptureSubmission?: (
    input: AgentPromptInput,
    options: AgentTurnOptions,
    messageAttachments: readonly AgentMessageAttachment[],
  ) => Promise<void>;
  /** 向外层表单同步提示词、Skill 或附件是否已有可提交内容。 */
  onInputStateChange?: (hasInput: boolean) => void;
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
  projectName: string;
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
  const resolved =
    attachment.source === "host"
      ? attachment.attachment
      : await uploadBrowserAttachment(attachment);
  return attachment.kind === "image"
    ? { ...resolved, detail: attachment.detail ?? "auto" }
    : resolved;
}

export async function persistPromptAttachments(
  attachments: readonly PromptInputAttachment[],
  uploadBrowserAttachment: (attachment: BrowserPromptInputAttachment) => Promise<AgentAttachment>,
): Promise<readonly PromptInputAttachment[]> {
  const persisted = new Array<PromptInputAttachment>(attachments.length);
  let nextIndex = 0;
  const persistNext = async (): Promise<void> => {
    while (nextIndex < attachments.length) {
      // 固定两路并发，避免多个大附件同时复制到 WebView 与 Rust 堆。
      const index = nextIndex;
      nextIndex += 1;
      const resolved = await resolvePromptAttachment(attachments[index]!, uploadBrowserAttachment);
      persisted[index] = {
        attachment: resolved,
        ...resolved,
        previewUrl: resolved.kind === "image" ? buildNativeAssetUrl(resolved.id) : "",
        source: "host",
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, attachments.length) }, persistNext));
  return persisted;
}
