import type { AgentReviewTarget, AgentSkill } from "@codexly/protocol";

import type { CodexlyMutationClient } from "../../projects/project-queries.js";
import { notifyActionSuccess } from "../../notifications/action-notifications.js";
import { resolveIdempotencyAttempt, startTaskReview } from "../composer-state.js";
import { getPromptCommandAvailability, type PromptCommandItem } from "./prompt-command.js";
import { insertPromptSkill, removePromptSlashCommand } from "./prompt-skill-editor.js";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import type { useComposerSession } from "./workbench-composer-session.js";
import type { createComposerSubmission } from "./workbench-composer-submission.js";

type ComposerCommandOptions = Readonly<{
  capabilities: WorkbenchComposerProps["capabilities"];
  client: CodexlyMutationClient;
  onRequestNotificationPermission: () => void;
  onTaskCreated: WorkbenchComposerProps["onTaskCreated"];
  onTaskStarted: WorkbenchComposerProps["onTaskStarted"];
  projectId: string;
  session: ReturnType<typeof useComposerSession>;
  submitPrompt: ReturnType<typeof createComposerSubmission>;
  t: (key: string) => string;
  taskId: string | undefined;
}>;

export function createComposerCommands({
  capabilities,
  client,
  onRequestNotificationPermission,
  onTaskCreated,
  onTaskStarted,
  projectId,
  session,
  submitPrompt,
  t,
  taskId,
}: ComposerCommandOptions) {
  const {
    activeCommandIndex,
    activeTaskId,
    baseBranches,
    closeCommandMenu,
    commandSlashCommand,
    composerController,
    filteredCommands,
    filteredSkills,
    pendingTask,
    promptContent,
    replacePromptContent,
    reviewMenuMode,
    routeScope,
    selectActiveFileReference,
    setActiveCommandIndex,
    setCommandMenuOpen,
    setCommandQuery,
    setCommandSlashCommand,
    setComposerModeState,
    setReviewMenuMode,
    skillEditorRef,
    state,
  } = session;
  const {
    actionLock: composerActionLock,
    commandAttempts,
    isCurrentScope,
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
  } = composerController;
  const focusEditor = (cursorPosition?: number) => {
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(cursorPosition);
    });
  };
  const getCommandAvailability = (command: PromptCommandItem) => {
    const availability = getPromptCommandAvailability(
      command,
      capabilities,
      activeTaskId !== undefined,
    );
    if (availability.available && state === "running") {
      return { available: false, reason: t("composer.taskRunning") } as const;
    }
    return availability;
  };

  const executePromptCommand = async (command: PromptCommandItem) => {
    const requestScope = routeScope;
    if (!getCommandAvailability(command).available) {
      return;
    }
    if (command.action === "plan" || command.action === "goal") {
      const slashCommand = commandSlashCommand;
      if (slashCommand === undefined) {
        return;
      }
      const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
      replacePromptContent(
        removePromptSlashCommand(currentContent, slashCommand),
        slashCommand.start,
      );
      setComposerModeState({ mode: command.action, scope: routeScope });
      closeCommandMenu();
      focusEditor(slashCommand.start);
      return;
    }

    setCommandQuery("");
    setCommandSlashCommand(undefined);
    replacePromptContent([]);

    if (command.action === "review") {
      setActiveCommandIndex(0);
      setReviewMenuMode("scopes");
      return;
    }
    setCommandMenuOpen(false);
    setReviewMenuMode(null);

    if (command.action === "initialize") {
      await submitPrompt(
        {
          files: [],
          text: t("composer.initializingAgentsPrompt"),
        },
        [],
      );
      return;
    }
    if (activeTaskId === undefined) {
      return;
    }

    await composerActionLock.run(async () => {
      if (command.action === "compact") {
        onRequestNotificationPermission();
      }
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(
        commandAttempts.current.get(command.action),
        `${command.action}:${activeTaskId}`,
      );
      commandAttempts.current.set(command.action, attempt);
      try {
        if (command.action === "compact") {
          await client.compactTask(projectId, activeTaskId, { idempotencyKey: attempt.key });
          if (isCurrentScope(requestScope)) {
            notifyActionSuccess(t("composer.compacting"));
          }
        } else {
          const response = await client.forkTask(
            projectId,
            activeTaskId,
            {},
            { idempotencyKey: attempt.key },
          );
          onTaskStarted(response.task);
        }
        if (isCurrentScope(requestScope)) {
          commandAttempts.current.delete(command.action);
        }
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Task command failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });
  };

  const executeReviewTarget = (target: AgentReviewTarget) =>
    composerActionLock.run(async () => {
      const requestScope = routeScope;
      onRequestNotificationPermission();
      closeCommandMenu();
      setIsSubmitting(true);
      setMutationError(null);
      const attempt = resolveIdempotencyAttempt(
        commandAttempts.current.get("review"),
        JSON.stringify({ target, taskId: activeTaskId ?? projectId }),
      );
      commandAttempts.current.set("review", attempt);
      try {
        const response = await startTaskReview(client, {
          idempotencyKey: attempt.key,
          onTaskCreated(task) {
            // Review 启动失败时保留已创建 Task，重试不能重复创建。
            if (isCurrentScope(requestScope)) {
              setPendingTaskState({ scope: requestScope, task });
              onTaskCreated?.(task);
            }
          },
          projectId,
          target,
          ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        });
        if (isCurrentScope(requestScope)) {
          commandAttempts.current.delete("review");
          setSubmittedTurnState({ scope: requestScope, turnId: response.turn.id });
          notifyActionSuccess(t("composer.reviewStarted"));
          if (taskId === undefined) {
            const startedTask = response.createdTask ?? pendingTask;
            if (startedTask !== undefined) {
              onTaskStarted(startedTask, response.turn);
            }
          }
        }
      } catch (error) {
        if (isCurrentScope(requestScope)) {
          setMutationError(error instanceof Error ? error : new Error("Review command failed"));
        }
      } finally {
        if (isCurrentScope(requestScope)) {
          setIsSubmitting(false);
        }
      }
    });

  const selectSkill = (skill: AgentSkill) => {
    // Skill 选择只保存不透明引用；原生路径由 Provider 在提交边界解析。
    const slashCommand = commandSlashCommand;
    if (slashCommand === undefined) {
      return;
    }
    const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
    const nextContent = insertPromptSkill(currentContent, slashCommand, skill);
    const cursorPosition = slashCommand.start + `$${skill.name}`.length;
    replacePromptContent(nextContent, cursorPosition);
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    focusEditor(cursorPosition);
  };

  const selectActiveCommandItem = () => {
    if (selectActiveFileReference()) {
      return;
    }
    if (reviewMenuMode === "scopes") {
      if (activeCommandIndex === 0) {
        void executeReviewTarget({ type: "uncommitted_changes" });
      } else if (activeCommandIndex === 1 && baseBranches.length > 0) {
        setActiveCommandIndex(0);
        setReviewMenuMode("branches");
      }
      return;
    }
    if (reviewMenuMode === "branches") {
      const branch = baseBranches[activeCommandIndex];
      if (branch !== undefined) {
        void executeReviewTarget({ branch, type: "base_branch" });
      }
      return;
    }
    const command = filteredCommands[activeCommandIndex];
    if (command !== undefined) {
      void executePromptCommand(command);
      return;
    }
    const skill = filteredSkills[activeCommandIndex - filteredCommands.length];
    if (skill !== undefined) {
      selectSkill(skill);
    }
  };

  return {
    executePromptCommand,
    executeReviewTarget,
    getCommandAvailability,
    selectActiveCommandItem,
    selectSkill,
  };
}
