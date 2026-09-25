import type { AgentAttachment } from "@/protocol/index.js";
import { v4 as createUuid } from "uuid";

import type {
  PromptInputAttachment,
  PromptInputMessage,
} from "../../../shared/components/agent/prompt-input.js";
import type { AsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { NativeMutationClient } from "../../projects/project-queries.js";
import type { ProjectDraftStore } from "../project-draft-store.js";
import { persistPromptAttachments } from "./workbench-composer-contracts.js";
import {
  isPromptSkillContentEmpty,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";

type ProjectDraftComposerActionsOptions = Readonly<{
  actionLock: AsyncActionLock;
  attachmentUploadPromises: Readonly<{
    current: Map<string, Promise<AgentAttachment>>;
  }>;
  attachments: readonly PromptInputAttachment[];
  clearComposerInput: () => void;
  client: Pick<NativeMutationClient, "uploadAttachment">;
  editingDraftId: string | undefined;
  fallbackErrors: Readonly<{
    attachmentUpload: string;
    saveDraft: string;
  }>;
  hasComposerInput: boolean;
  isCurrentScope: (scope: string) => boolean;
  isSubmitting: boolean;
  onAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  onEditingComplete: () => void;
  onPromptChange: (
    content: PromptSkillContent,
    serializedText: string,
    cursorOffset: number,
  ) => void;
  projectDraftStore: ProjectDraftStore;
  projectId: string;
  promptContent: PromptSkillContent;
  routeScope: string;
  setIsSubmitting: (submitting: boolean) => void;
  setMutationError: (error: Error | null) => void;
  skillEditorRef: Readonly<{ current: PromptSkillEditorHandle | null }>;
  submitPrompt: (message: PromptInputMessage) => Promise<boolean>;
  uploadAttempts: Readonly<{ current: Map<string, string> }>;
  uploadedAttachments: Readonly<{ current: Map<string, AgentAttachment> }>;
}>;

function hasSameAttachmentSelection(
  left: readonly Readonly<{ id: string; source: string }>[],
  right: readonly Readonly<{ id: string; source: string }>[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (attachment, index) =>
        attachment.id === right[index]?.id && attachment.source === right[index]?.source,
    )
  );
}

export function createProjectDraftComposerActions({
  actionLock,
  attachmentUploadPromises,
  attachments,
  clearComposerInput,
  client,
  editingDraftId,
  fallbackErrors,
  hasComposerInput,
  isCurrentScope,
  isSubmitting,
  onAttachmentsChange,
  onEditingComplete,
  onPromptChange,
  projectDraftStore,
  projectId,
  promptContent,
  routeScope,
  setIsSubmitting,
  setMutationError,
  skillEditorRef,
  submitPrompt,
  uploadAttempts,
  uploadedAttachments,
}: ProjectDraftComposerActionsOptions) {
  const uploadAttachment = async (
    attachment: Parameters<Parameters<typeof persistPromptAttachments>[1]>[0],
  ) => {
    const cached = uploadedAttachments.current.get(attachment.id);
    if (cached !== undefined) return cached;
    const pendingUpload = attachmentUploadPromises.current.get(attachment.id);
    if (pendingUpload !== undefined) return pendingUpload;
    const idempotencyKey = uploadAttempts.current.get(attachment.id) ?? createUuid();
    uploadAttempts.current.set(attachment.id, idempotencyKey);
    const uploadPromise = client
      .uploadAttachment(
        projectId,
        {
          content: attachment.file,
          kind: attachment.kind,
          name: attachment.name,
        },
        { idempotencyKey },
      )
      .then((response) => {
        uploadedAttachments.current.set(attachment.id, response.attachment);
        return response.attachment;
      });
    attachmentUploadPromises.current.set(attachment.id, uploadPromise);
    try {
      return await uploadPromise;
    } finally {
      if (attachmentUploadPromises.current.get(attachment.id) === uploadPromise) {
        attachmentUploadPromises.current.delete(attachment.id);
      }
    }
  };

  const changeAttachments = (files: readonly PromptInputAttachment[]) => {
    onAttachmentsChange(files);
    const draftId = editingDraftId;
    if (draftId !== undefined && files.length === 0 && isPromptSkillContentEmpty(promptContent)) {
      projectDraftStore.discardWorking(projectId, draftId);
      onEditingComplete();
      return;
    }
    if (draftId === undefined || !files.some((attachment) => attachment.source === "browser")) {
      return;
    }
    if (projectDraftStore.readWorking(projectId, draftId) === undefined) return;
    // 选择后立即稳定化浏览器附件，工作副本可跨任务和重启继续恢复。
    void persistPromptAttachments(files, uploadAttachment)
      .then((persisted) => {
        const current = projectDraftStore.readWorking(projectId, draftId);
        if (current === undefined || !hasSameAttachmentSelection(current.attachments, files)) return;
        projectDraftStore.updateWorking(projectId, draftId, {
          ...current,
          attachments: persisted,
        });
      })
      .catch((error: unknown) => {
        setMutationError(error instanceof Error ? error : new Error(fallbackErrors.attachmentUpload));
      });
  };

  const changePrompt = (
    content: PromptSkillContent,
    serializedText: string,
    cursorOffset: number,
  ) => {
    onPromptChange(content, serializedText, cursorOffset);
    if (
      editingDraftId !== undefined &&
      attachments.length === 0 &&
      isPromptSkillContentEmpty(content)
    ) {
      projectDraftStore.discardWorking(projectId, editingDraftId);
      onEditingComplete();
    }
  };

  const save = async () => {
    if (!hasComposerInput || isSubmitting) return;
    await actionLock.run(async () => {
      setIsSubmitting(true);
      setMutationError(null);
      try {
        const persistedAttachments = await persistPromptAttachments(
          attachments,
          uploadAttachment,
        );
        const draft = {
          attachments: persistedAttachments,
          content: skillEditorRef.current?.getContent() ?? promptContent,
        };
        if (editingDraftId === undefined) {
          projectDraftStore.create(projectId, draft);
          if (isCurrentScope(routeScope)) clearComposerInput();
        } else {
          const saved = projectDraftStore.save(projectId, editingDraftId, draft);
          if (saved === undefined) throw new Error("Project todo is unavailable");
          if (isCurrentScope(routeScope)) onEditingComplete();
        }
      } catch (error) {
        if (isCurrentScope(routeScope)) {
          setMutationError(error instanceof Error ? error : new Error(fallbackErrors.saveDraft));
        }
      } finally {
        if (isCurrentScope(routeScope)) setIsSubmitting(false);
      }
    });
  };

  const submit = async (message: PromptInputMessage) => {
    const submitted = await submitPrompt(message);
    if (submitted && editingDraftId !== undefined) {
      projectDraftStore.remove(projectId, editingDraftId);
      onEditingComplete();
    }
  };

  return { changeAttachments, changePrompt, save, submit };
}
