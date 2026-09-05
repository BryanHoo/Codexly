import type {
  AgentCapabilities,
  AgentModel,
  AgentSkill,
  AgentTaskSettings,
  HostFileKind,
  ProjectGitStatus,
  ProjectFileSearchEntry,
} from "@codexly/protocol";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import { useComposerDraftStore, type ComposerDraft } from "../composer-draft-context.js";
import { createProjectTodoBinding, shouldRestoreComposerBinding } from "../project-todo-binding.js";
import type { ProjectTodoStore } from "../project-todo-store.js";
import {
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  resolveReasoningEffort,
  resolveThreadComposerSettings,
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
  collectPromptHistoryEntriesFromTaskStore,
  resolvePromptHistoryIndex,
  type PromptHistoryDirection,
} from "./prompt-history.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import type { ComposerMode } from "./workbench-composer-contracts.js";

type ComposerSessionOptions = Readonly<{
  capabilities: AgentCapabilities | undefined;
  composerDraftId: string | undefined;
  client: WorkbenchComposerProps["client"];
  editingTodoId: string | undefined;
  gitStatus: ProjectGitStatus | undefined;
  models: readonly AgentModel[];
  initialDraft: ComposerDraft | undefined;
  onSubmissionStateChange: WorkbenchComposerProps["onSubmissionStateChange"];
  projectId: string;
  projectPath: string;
  projectToolsEnabled: boolean;
  projectTodos: ProjectTodoStore;
  runtime: TaskRuntimeView | undefined;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId: string | undefined;
}>;

const emptyProjectFileSearchResults: readonly ProjectFileSearchEntry[] = [];

export function useComposerSession({
  capabilities,
  composerDraftId,
  client,
  editingTodoId,
  gitStatus,
  models,
  initialDraft,
  onSubmissionStateChange,
  projectId,
  projectPath,
  projectToolsEnabled,
  projectTodos,
  runtime,
  settings,
  skills,
  taskId,
}: ComposerSessionOptions) {
  // Git 与文件异步操作绑定当前根；切换根后旧请求不得更新新根的 Composer 状态。
  const routeScope = `${projectId}:${composerDraftId ?? taskId ?? "draft"}:${projectPath}`;
  const composerDraftStore = useComposerDraftStore();
  const composerDraftBinding = useMemo(
    () =>
      createProjectTodoBinding({
        composerDrafts: composerDraftStore,
        editingTodoId,
        projectId,
        projectTodos,
        taskId: composerDraftId ?? taskId,
      }),
    [composerDraftId, composerDraftStore, editingTodoId, projectId, projectTodos, taskId],
  );
  const composerScope = composerDraftBinding.scope;
  const initialComposerDraft = initialDraft ?? composerDraftBinding.read();
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
  const submittedTurnStatus =
    submittedTurnId === undefined
      ? undefined
      : runtime?.store?.getState().turnsById[submittedTurnId]?.status;
  const activeTurnId =
    runtime?.activeTurnId ??
    (submittedTurnId !== undefined &&
    (submittedTurnStatus === undefined || submittedTurnStatus === "running")
      ? submittedTurnId
      : undefined);
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
  const threadConfiguration = runtime?.metadata?.threadConfiguration;
  const activeSettings = useMemo(
    () =>
      settingsOverride?.scope === routeScope
        ? settingsOverride.settings
        : resolveThreadComposerSettings(settings, threadConfiguration),
    [routeScope, settings, settingsOverride, threadConfiguration],
  );
  const composerMode = composerModeState?.scope === routeScope ? composerModeState.mode : undefined;
  const selectedModel =
    models.find((model) => model.id === activeSettings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const selectedReasoningEffort = resolveReasoningEffort(
    selectedModel,
    activeSettings.reasoningEffort,
  );
  const contextUsage = runtime?.metadata?.contextUsage;
  const promptHistoryEntries = useMemo(
    () =>
      runtime?.store === undefined
        ? []
        : collectPromptHistoryEntriesFromTaskStore(runtime.store.getState(), skills),
    [runtime, skills],
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
      composerDraftBinding.update((current) => ({
        ...current,
        attachments: files,
      }));
    },
    [composerDraftBinding],
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
      composerDraftBinding.update((current) => ({
        ...current,
        content: nextContent,
      }));
      // 程序化命令直接同步编辑 DOM，避免受控回写破坏 IME 组合缓冲。
      skillEditorRef.current?.replace(nextContent, cursorOffset);
    },
    [composerDraftBinding],
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
      composerDraftBinding.update((current) => ({
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
    [closeFileMenu, composerDraftBinding, projectToolsEnabled],
  );

  const clearComposerInput = useCallback(() => {
    setPromptContent([]);
    setPromptHistoryIndex(null);
    promptHistoryDraftRef.current = [];
    setAttachments([]);
    skillEditorRef.current?.replace([]);
    // 编辑器同步完成后再删持久草稿，禁止其变更回调重新写入旧内容。
    composerDraftBinding.clear();
  }, [composerDraftBinding]);

  useLayoutEffect(() => {
    if (
      !shouldRestoreComposerBinding(
        {
          routeScope: previousRouteScopeRef.current,
          storageScope: previousComposerScopeRef.current,
        },
        { routeScope, storageScope: composerScope },
      )
    ) {
      return;
    }
    previousRouteScopeRef.current = routeScope;
    const composerScopeChanged = previousComposerScopeRef.current !== composerScope;
    if (composerScopeChanged) {
      previousComposerScopeRef.current = composerScope;
      const restoredDraft = composerDraftBinding.read();
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
  }, [composerDraftBinding, composerScope, resetController, routeScope]);

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
