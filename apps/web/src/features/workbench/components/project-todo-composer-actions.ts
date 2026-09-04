import type { AgentAttachment } from "@codexly/protocol";
import { v4 as createUuid } from "uuid";

import type {
  PromptInputAttachment,
  PromptInputMessage,
} from "../../../shared/components/agent/prompt-input.js";
import type { AsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { CodexlyMutationClient } from "../../projects/project-queries.js";
import type { ProjectTodoStore } from "../project-todo-store.js";
import { persistPromptAttachments } from "./workbench-composer-contracts.js";
import type { PromptSkillContent, PromptSkillEditorHandle } from "./prompt-skill-editor.js";

type ProjectTodoComposerActionsOptions = Readonly<{
  actionLock: AsyncActionLock;
  attachments: readonly PromptInputAttachment[];
  clearComposerInput: () => void;
  client: Pick<CodexlyMutationClient, "uploadAttachment">;
  editingTodoId: string | undefined;
  fallbackError: string;
  hasComposerInput: boolean;
  isCurrentScope: (scope: string) => boolean;
  isSubmitting: boolean;
  onEditingComplete: () => void;
  projectId: string;
  projectTodos: ProjectTodoStore;
  promptContent: PromptSkillContent;
  routeScope: string;
  setIsSubmitting: (submitting: boolean) => void;
  setMutationError: (error: Error | null) => void;
  skillEditorRef: Readonly<{ current: PromptSkillEditorHandle | null }>;
  submitPrompt: (message: PromptInputMessage) => Promise<boolean>;
  uploadAttempts?: Readonly<{ current: Map<string, string> }>;
  uploadedAttachments?: Readonly<{ current: Map<string, AgentAttachment> }>;
}>;

export function createProjectTodoComposerActions({
  actionLock,
  attachments,
  clearComposerInput,
  client,
  editingTodoId,
  fallbackError,
  hasComposerInput,
  isCurrentScope,
  isSubmitting,
  onEditingComplete,
  projectId,
  projectTodos,
  promptContent,
  routeScope,
  setIsSubmitting,
  setMutationError,
  skillEditorRef,
  submitPrompt,
  uploadAttempts = { current: new Map() },
  uploadedAttachments = { current: new Map() },
}: ProjectTodoComposerActionsOptions) {
  const uploadAttachment = async (
    attachment: Extract<PromptInputAttachment, { source: "browser" }>,
  ) => {
    const cached = uploadedAttachments.current.get(attachment.id);
    if (cached !== undefined) return cached;
    const idempotencyKey = uploadAttempts.current.get(attachment.id) ?? createUuid();
    uploadAttempts.current.set(attachment.id, idempotencyKey);
    const response = await client.uploadAttachment(
      projectId,
      { content: attachment.file, kind: attachment.kind, name: attachment.name },
      { idempotencyKey },
    );
    uploadedAttachments.current.set(attachment.id, response.attachment);
    return response.attachment;
  };

  const save = async () => {
    if (!hasComposerInput || isSubmitting) return;
    await actionLock.run(async () => {
      setIsSubmitting(true);
      setMutationError(null);
      try {
        const persistedAttachments = await persistPromptAttachments(
          projectId,
          attachments,
          uploadAttachment,
        );
        const draft = {
          attachments: persistedAttachments,
          content: skillEditorRef.current?.getContent() ?? promptContent,
        };
        if (editingTodoId === undefined) {
          projectTodos.create(projectId, draft);
          if (isCurrentScope(routeScope)) clearComposerInput();
        } else {
          const saved = projectTodos.save(projectId, editingTodoId, draft);
          if (saved === undefined) throw new Error("Project todo is unavailable");
          if (isCurrentScope(routeScope)) onEditingComplete();
        }
      } catch (error) {
        if (isCurrentScope(routeScope)) {
          setMutationError(error instanceof Error ? error : new Error(fallbackError));
        }
      } finally {
        if (isCurrentScope(routeScope)) setIsSubmitting(false);
      }
    });
  };

  const submit = async (message: PromptInputMessage) => {
    const submitted = await submitPrompt(message);
    if (submitted && editingTodoId !== undefined) {
      projectTodos.remove(projectId, editingTodoId);
      onEditingComplete();
    }
  };

  return { save, submit };
}
