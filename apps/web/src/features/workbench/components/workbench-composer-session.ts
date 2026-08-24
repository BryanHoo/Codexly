import type {
  AgentCapabilities,
  AgentModel,
  AgentSkill,
  AgentTaskSettings,
  HostFileKind,
  ProjectGitStatus,
  ProjectFileSearchEntry,
} from "@code-agent/protocol";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { createComposerDraftScope, useComposerDraftStore } from "../composer-draft-context.js";
import {
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  resolveActiveTurnId,
  resolveReasoningEffort,
} from "../composer-state.js";
import { useWorkbenchComposerController } from "../hooks/use-workbench-composer-controller.js";
import { useProjectFileSearch } from "../hooks/use-project-file-search.js";
import {
  filterPromptCommandItems,
  filterPromptSkills,
  getPromptCommandItems,
  resolvePromptFileMention,
  resolvePromptSlashCommand,
  type PromptFileMention,
  type PromptSlashCommand,
} from "./prompt-command.js";
import {
  appendPromptFileReference,
  fileReferencePlainText,
  insertPromptFileReference,
  isPromptTextRange,
  serializePromptSkillContent,
  toPromptSkillSubmission,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";
import {
  collectPromptHistoryEntries,
  resolvePromptHistoryIndex,
  type PromptHistoryDirection,
} from "./prompt-history.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import type { ComposerMode } from "./workbench-composer-contracts.js";

type ComposerSessionOptions = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: WorkbenchComposerProps["client"];
  gitStatus: ProjectGitStatus | undefined;
  models: readonly AgentModel[];
  onSubmissionStateChange: WorkbenchComposerProps["onSubmissionStateChange"];
  projectId: string;
  projectPath: string;
  projectToolsEnabled: boolean;
  runtime: TaskRuntimeView | undefined;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId: string | undefined;
}>;

const emptyProjectFileSearchResults: readonly ProjectFileSearchEntry[] = [];

export function useComposerSession({
  capabilities,
  client,
  gitStatus,
  models,
  onSubmissionStateChange,
  projectId,
  projectPath,
  projectToolsEnabled,
  runtime,
  settings,
  skills,
  taskId,
}: ComposerSessionOptions) {
  // Git 与文件异步操作绑定当前根；切换根后旧请求不得更新新根的 Composer 状态。
  const routeScope = `${projectId}:${taskId ?? "draft"}:${projectPath}`;
  const composerScope = createComposerDraftScope(projectId, taskId);
  const composerDraftStore = useComposerDraftStore();
  const initialComposerDraft = composerDraftStore.read(composerScope);
  const [settingsOverride, setSettingsOverride] = useState<{
    scope: string;
    settings: AgentTaskSettings;
  }>();
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<readonly PromptInputAttachment[]>(
    initialComposerDraft.attachments,
  );
  const [attachmentPickerKind, setAttachmentPickerKind] = useState<HostFileKind>();
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileMention, setFileMention] = useState<PromptFileMention>();
  const [fileQuery, setFileQuery] = useState("");
  const [reviewMenuMode, setReviewMenuMode] = useState<"branches" | "scopes" | null>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSlashCommand, setCommandSlashCommand] = useState<PromptSlashCommand>();
  const [promptContent, setPromptContent] = useState<PromptSkillContent>(
    initialComposerDraft.content,
  );
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(null);
  const [composerModeState, setComposerModeState] =
    useState<Readonly<{ mode: ComposerMode; scope: string }>>();
  const composerController = useWorkbenchComposerController(routeScope, onSubmissionStateChange);
  const {
    isSubmitting,
    mutationError,
    pendingTaskState,
    reset: resetController,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    submittedTurnState,
  } = composerController;
  const commandMenuId = useId();
  const commandSurfaceRef = useRef<HTMLDivElement>(null);
  const skillEditorRef = useRef<PromptSkillEditorHandle>(null);
  const promptHistoryDraftRef = useRef<PromptSkillContent>(initialComposerDraft.content);
  const previousRouteScopeRef = useRef(routeScope);
  const previousComposerScopeRef = useRef(composerScope);
  const submittedTurnId =
    submittedTurnState?.scope === routeScope ? submittedTurnState.turnId : undefined;
  const pendingTask = pendingTaskState?.scope === routeScope ? pendingTaskState.task : undefined;
  const activeTurnId = resolveActiveTurnId(runtime?.snapshot, submittedTurnId);
  const activeTaskId = taskId ?? pendingTask?.id;
  const { canInterrupt, canSubmit, canSteer } = deriveComposerActions(
    capabilities,
    activeTaskId !== undefined,
  );
  const connectionState = runtime?.connectionState ?? "connected";
  const state = deriveComposerState({
    activeTurnId,
    connectionState,
    isSubmitting,
    mutationFailed: mutationError !== null || runtime?.error !== null,
  });
  const promptSubmission = toPromptSkillSubmission(promptContent);
  const activeSettings =
    settingsOverride?.scope === routeScope ? settingsOverride.settings : settings;
  const composerMode = composerModeState?.scope === routeScope ? composerModeState.mode : undefined;
  const selectedModel =
    models.find((model) => model.id === activeSettings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const selectedReasoningEffort = resolveReasoningEffort(
    selectedModel,
    activeSettings.reasoningEffort,
  );
  const contextUsage = runtime?.snapshot?.contextUsage;
  const promptHistoryEntries = useMemo(
    () => collectPromptHistoryEntries(runtime?.snapshot?.turns ?? [], skills),
    [runtime?.snapshot?.turns, skills],
  );
  const attachmentCount = attachments.length;
  const { attachmentsDisabled, draftInputDisabled, turnControlsDisabled } =
    deriveComposerInputAvailability(state);
  const fileSearch = useProjectFileSearch(
    client,
    projectId,
    projectPath,
    fileQuery,
    fileMenuOpen && projectToolsEnabled && !turnControlsDisabled,
  );
  const fileSearchResults = fileSearch.data?.data ?? emptyProjectFileSearchResults;

  const filteredSkills = filterPromptSkills(
    capabilities?.skills.use === true ? skills : [],
    commandQuery,
  );
  const filteredCommands = filterPromptCommandItems(
    getPromptCommandItems({ projectToolsEnabled }),
    commandQuery,
  );
  const baseBranches = gitStatus?.baseBranches ?? [];
  const menuItemCount = fileMenuOpen
    ? fileSearchResults.length
    : reviewMenuMode === "scopes"
      ? 2
      : reviewMenuMode === "branches"
        ? baseBranches.length
        : filteredSkills.length + filteredCommands.length;
  const activeCommandItemId =
    (!commandMenuOpen && !fileMenuOpen) || menuItemCount === 0
      ? undefined
      : `${commandMenuId}-item-${String(activeCommandIndex)}`;
  const handleAttachmentsChange = useCallback(
    (files: readonly PromptInputAttachment[]) => {
      setAttachments(files);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        attachments: files,
      }));
    },
    [composerDraftStore, composerScope],
  );
  const closeCommandMenu = useCallback(() => {
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setReviewMenuMode(null);
  }, []);
  const closeFileMenu = useCallback(() => {
    setFileMenuOpen(false);
    setFileMention(undefined);
    setFileQuery("");
  }, []);
  const replacePromptContent = useCallback(
    (nextContent: PromptSkillContent, cursorOffset?: number) => {
      setPromptContent(nextContent);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        content: nextContent,
      }));
      // 程序化命令直接同步编辑 DOM，避免受控回写破坏 IME 组合缓冲。
      skillEditorRef.current?.replace(nextContent, cursorOffset);
    },
    [composerDraftStore, composerScope],
  );
  const navigatePromptHistory = useCallback(
    (direction: PromptHistoryDirection) => {
      const nextIndex = resolvePromptHistoryIndex(
        promptHistoryIndex,
        direction,
        promptHistoryEntries.length,
      );
      if (nextIndex === null && promptHistoryIndex === null) {
        return false;
      }
      if (promptHistoryIndex === null) {
        // 首次进入历史时保留未提交草稿，向下越过最新记录时原样恢复。
        promptHistoryDraftRef.current = skillEditorRef.current?.getContent() ?? promptContent;
      }
      const nextContent =
        nextIndex === null ? promptHistoryDraftRef.current : promptHistoryEntries[nextIndex];
      if (nextContent === undefined) {
        return false;
      }
      setPromptHistoryIndex(nextIndex);
      replacePromptContent(nextContent, serializePromptSkillContent(nextContent).length);
      return true;
    },
    [promptContent, promptHistoryEntries, promptHistoryIndex, replacePromptContent],
  );
  const selectFileReference = useCallback(
    (file: ProjectFileSearchEntry) => {
      if (fileMention === undefined) {
        return;
      }
      const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
      const nextContent = insertPromptFileReference(currentContent, fileMention, file);
      const cursorPosition = fileMention.start + fileReferencePlainText(file).length;
      replacePromptContent(nextContent, cursorPosition);
      closeFileMenu();
      requestAnimationFrame(() => {
        skillEditorRef.current?.focus(cursorPosition);
      });
    },
    [closeFileMenu, fileMention, promptContent, replacePromptContent],
  );
  const referenceProjectPath = useCallback(
    (file: ProjectFileSearchEntry) => {
      const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
      const nextContent = appendPromptFileReference(currentContent, file);
      const cursorPosition = serializePromptSkillContent(nextContent).length;
      closeCommandMenu();
      closeFileMenu();
      setPromptHistoryIndex(null);
      replacePromptContent(nextContent, cursorPosition);
      requestAnimationFrame(() => {
        skillEditorRef.current?.focus(cursorPosition);
      });
    },
    [closeCommandMenu, closeFileMenu, promptContent, replacePromptContent],
  );
  const selectActiveFileReference = useCallback(() => {
    if (!fileMenuOpen) {
      return false;
    }
    const file = fileSearchResults[activeCommandIndex];
    if (file !== undefined) {
      selectFileReference(file);
    }
    return true;
  }, [activeCommandIndex, fileMenuOpen, fileSearchResults, selectFileReference]);
  const handlePromptChange = useCallback(
    (nextContent: PromptSkillContent, serializedText: string, cursorOffset: number) => {
      setPromptContent(nextContent);
      setPromptHistoryIndex(null);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        content: nextContent,
      }));
      const nextFileMention = resolvePromptFileMention(serializedText, cursorOffset);
      if (
        projectToolsEnabled &&
        nextFileMention !== null &&
        isPromptTextRange(nextContent, nextFileMention)
      ) {
        setActiveCommandIndex(0);
        setCommandMenuOpen(false);
        setCommandQuery("");
        setCommandSlashCommand(undefined);
        setReviewMenuMode(null);
        setFileMenuOpen(true);
        setFileMention(nextFileMention);
        setFileQuery(nextFileMention.query);
        return;
      }
      closeFileMenu();
      const slashCommand = resolvePromptSlashCommand(serializedText, cursorOffset);
      if (slashCommand === null) {
        setCommandMenuOpen(false);
        setReviewMenuMode(null);
        setCommandQuery("");
        setCommandSlashCommand(undefined);
        return;
      }
      // 文本开头或空白后的 `/` 片段驱动过滤，连续正文中的斜杠保持普通字符。
      setActiveCommandIndex(0);
      setCommandMenuOpen(true);
      setReviewMenuMode(null);
      setCommandQuery(slashCommand.query);
      setCommandSlashCommand(slashCommand);
    },
    [closeFileMenu, composerDraftStore, composerScope, projectToolsEnabled],
  );

  const clearComposerInput = useCallback(() => {
    composerDraftStore.update(composerScope, (current) => ({
      ...current,
      attachments: [],
      content: [],
    }));
    setPromptContent([]);
    setPromptHistoryIndex(null);
    promptHistoryDraftRef.current = [];
    setAttachments([]);
    skillEditorRef.current?.replace([]);
  }, [composerDraftStore, composerScope]);

  useLayoutEffect(() => {
    if (previousRouteScopeRef.current === routeScope) {
      return;
    }
    previousRouteScopeRef.current = routeScope;
    const composerScopeChanged = previousComposerScopeRef.current !== composerScope;
    if (composerScopeChanged) {
      previousComposerScopeRef.current = composerScope;
      const restoredDraft = composerDraftStore.read(composerScope);
      // 切换聊天时恢复对应草稿，同时保留编辑节点和焦点，避免重建原生 IME 会话。
      setPromptContent(restoredDraft.content);
      setPromptHistoryIndex(null);
      promptHistoryDraftRef.current = restoredDraft.content;
      setAttachments(restoredDraft.attachments);
      setAttachmentPickerKind(undefined);
      skillEditorRef.current?.replace(restoredDraft.content);
      setSettingsOverride(undefined);
      setComposerModeState(undefined);
      setActiveCommandIndex(0);
      setCommandMenuOpen(false);
      setFileMenuOpen(false);
      setFileMention(undefined);
      setFileQuery("");
      setReviewMenuMode(null);
      setCommandQuery("");
      setCommandSlashCommand(undefined);
    }
    // 路由相关请求结果不能写入刚激活的其他聊天。
    resetController(composerScopeChanged);
  }, [composerDraftStore, composerScope, resetController, routeScope]);

  return {
    activeCommandIndex,
    activeCommandItemId,
    activeSettings,
    activeTaskId,
    activeTurnId,
    attachmentCount,
    attachmentPickerKind,
    attachments,
    attachmentsDisabled,
    baseBranches,
    canInterrupt,
    canSteer,
    canSubmit,
    clearComposerInput,
    closeCommandMenu,
    closeFileMenu,
    commandMenuId,
    commandMenuOpen,
    commandSlashCommand,
    commandSurfaceRef,
    composerController,
    composerDraftStore,
    composerScope,
    connectionState,
    contextUsage,
    draftInputDisabled,
    filteredCommands,
    filteredSkills,
    fileMenuOpen,
    fileMention,
    fileQuery,
    fileSearchError: fileSearch.error,
    fileSearchPending: fileSearch.isPending,
    fileSearchResults,
    handleAttachmentsChange,
    handlePromptChange,
    isSubmitting,
    menuItemCount,
    mutationError,
    navigatePromptHistory,
    pendingTask,
    composerMode,
    promptContent,
    promptSubmission,
    referenceProjectPath,
    replacePromptContent,
    reviewMenuMode,
    routeScope,
    selectedModel,
    selectedReasoningEffort,
    selectActiveFileReference,
    selectFileReference,
    setActiveCommandIndex,
    setAttachmentPickerKind,
    setAttachments,
    setCommandMenuOpen,
    setFileMenuOpen,
    setFileMention,
    setFileQuery,
    setCommandQuery,
    setCommandSlashCommand,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setComposerModeState,
    setPromptContent,
    setReviewMenuMode,
    setSettingsOverride,
    setSubmittedTurnState,
    skillEditorRef,
    state,
    turnControlsDisabled,
  };
}
