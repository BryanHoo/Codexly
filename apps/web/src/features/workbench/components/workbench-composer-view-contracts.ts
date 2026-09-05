import type {
  AgentContextUsage,
  AgentGoal,
  AgentModel,
  AgentReviewTarget,
  AgentSkill,
  AgentTaskSettings,
  ProjectFileSearchEntry,
  ProjectGitStatus,
  ProjectGitWorktree,
  ProjectRoot,
} from "@codexly/protocol";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type {
  PromptInputAttachment,
  PromptInputAttachmentKind,
  PromptInputMessage,
} from "../../../shared/components/agent/prompt-input.js";
import type { QueuedComposerPrompt } from "../composer-queue-state.js";
import type { ComposerState, ComposerSubmitAction } from "../composer-state.js";
import type { PromptCommandItem } from "./prompt-command.js";
import type { PromptSkillContent, PromptSkillEditorHandle } from "./prompt-skill-editor.js";
import type { ComposerMode } from "./workbench-composer-contracts.js";
import type { ProjectTodoRecord } from "../project-todo-store.js";

export type CommandAvailability = Readonly<{ available: boolean; reason?: string }>;

export type WorkbenchComposerViewProps = Readonly<{
  activeCommandIndex: number;
  activeCommandItemId: string | undefined;
  activeSettings: AgentTaskSettings;
  activeTurnId: string | undefined;
  attachments: readonly PromptInputAttachment[];
  attachmentsDisabled: boolean;
  baseBranches: readonly string[];
  canInterrupt: boolean;
  canSteer: boolean;
  canSubmit: boolean;
  captureMode: boolean;
  captureSubmitVisible: boolean;
  commandMenuId: string;
  commandMenuOpen: boolean;
  commandSurfaceRef: RefObject<HTMLDivElement | null>;
  composerMode: ComposerMode | undefined;
  composerScope: string;
  contextUsage: AgentContextUsage | null | undefined;
  creatingBranch: string | undefined;
  creatingWorktree: string | undefined;
  draftInputDisabled: boolean;
  editingTodoId: string | undefined;
  editQueuedPrompt: (queuedPrompt: QueuedComposerPrompt) => void;
  filteredCommands: readonly PromptCommandItem[];
  filteredSkills: readonly AgentSkill[];
  fileMenuOpen: boolean;
  fileSearchError: Error | null;
  fileSearchPending: boolean;
  fileSearchResults: readonly ProjectFileSearchEntry[];
  fastModeAvailable: boolean;
  fastModeEnabled: boolean;
  footerVisible: boolean;
  getCommandAvailability: (command: PromptCommandItem) => CommandAvailability;
  gitStatus: ProjectGitStatus | undefined;
  goal: AgentGoal | null | undefined;
  hasComposerInput: boolean;
  isSubmitting: boolean;
  menuItemCount: number;
  moveQueuedPrompt: (queuedPromptId: string, offset: -1 | 1) => void;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  onBranchCreate: (branch: string) => Promise<boolean>;
  onBranchChange: (branch: string) => void;
  onWorktreeChange: (path: string) => void;
  onWorktreeCreate: (branch: string) => Promise<boolean>;
  onExecuteCommand: (command: PromptCommandItem) => void;
  onExecuteReview: (target: AgentReviewTarget) => void;
  onFastModeChange: (enabled: boolean) => void;
  onInterrupt: () => void;
  onOpenProjectPath: () => void;
  onProjectRootChange: (rootId: string) => void;
  onOpenReviewBranches: () => void;
  onComposerModeRemove: () => void;
  onProjectTodoDelete: (todoId: string) => void;
  onProjectTodoRestore: (todoId: string) => void;
  onProjectTodoSave: () => void;
  onPromptChange: (
    content: PromptSkillContent,
    serializedText: string,
    cursorOffset: number,
  ) => void;
  onPromptHistoryNavigate: (direction: "next" | "previous") => boolean;
  onSelectActiveCommand: () => void;
  onSelectAttachmentKind: (kind: PromptInputAttachmentKind) => void;
  onSelectFileReference: (file: ProjectFileSearchEntry) => void;
  onSelectSkill: (skill: AgentSkill) => void;
  onSettingsChange: (settings: AgentTaskSettings, field: keyof AgentTaskSettings) => void;
  onSubmit: (message: PromptInputMessage) => void;
  onViewError: (error: Error) => void;
  projectPath: string;
  projectPathOpenDisabled: boolean;
  projectRoots: readonly ProjectRoot[];
  projectToolsEnabled: boolean;
  projectName: string;
  projectTodos: readonly ProjectTodoRecord[];
  promptContent: PromptSkillContent;
  promptSubmissionText: string;
  queuedPrompts: readonly QueuedComposerPrompt[];
  removeQueuedPrompt: (queuedPromptId: string) => void;
  reviewMenuMode: "branches" | "scopes" | null;
  sandboxModeSelectable: boolean;
  selectedModel: AgentModel | undefined;
  selectedReasoningEffort: string | undefined;
  selectedProjectRootId: string;
  setActiveCommandIndex: Dispatch<SetStateAction<number>>;
  skills: readonly AgentSkill[];
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
  state: ComposerState;
  steerQueuedPrompt: (queuedPrompt: QueuedComposerPrompt) => void;
  submitAction: ComposerSubmitAction;
  switchingBranch: string | undefined;
  switchingWorktree: string | undefined;
  taskId: string | undefined;
  turnControlsDisabled: boolean;
  worktrees: readonly ProjectGitWorktree[];
}>;

export function resolveQueuedPromptSummary(
  queuedPrompt: QueuedComposerPrompt,
  attachmentSummary: string,
): string {
  return (
    queuedPrompt.text ||
    queuedPrompt.skills.map((skill) => `$${skill.name}`).join(" ") ||
    attachmentSummary
  );
}
