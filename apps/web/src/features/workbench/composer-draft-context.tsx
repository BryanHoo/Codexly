import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { PromptInputAttachment } from "../../shared/components/agent/prompt-input.js";
import type { PromptSkillContent } from "./components/prompt-skill-editor.js";

export type ComposerDraft = Readonly<{
  attachments: readonly PromptInputAttachment[];
  content: PromptSkillContent;
}>;

const emptyComposerDraft: ComposerDraft = {
  attachments: [],
  content: [],
};

type ComposerDraftStore = Readonly<{
  clear: (scope: string) => void;
  dispose: () => void;
  read: (scope: string) => ComposerDraft;
  update: (scope: string, update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

const ComposerDraftContext = createContext<ComposerDraftStore | undefined>(undefined);

export function createComposerDraftScope(projectId: string, taskId?: string): string {
  return JSON.stringify([projectId, taskId ?? "draft"]);
}

function isEmptyComposerDraft(draft: ComposerDraft): boolean {
  return draft.content.length === 0 && draft.attachments.length === 0;
}

function draftPreviewUrls(draft: ComposerDraft): readonly string[] {
  return draft.attachments.map((attachment) => attachment.previewUrl);
}

function revokeDraftPreviews(draft: ComposerDraft) {
  for (const previewUrl of new Set(draftPreviewUrls(draft))) {
    if (previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

function revokeRemovedDraftPreviews(previousDraft: ComposerDraft, nextDraft: ComposerDraft) {
  const retainedPreviewUrls = new Set(draftPreviewUrls(nextDraft));
  for (const previewUrl of new Set(draftPreviewUrls(previousDraft))) {
    if (!retainedPreviewUrls.has(previewUrl) && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

export function createComposerDraftStore(): ComposerDraftStore {
  const drafts = new Map<string, ComposerDraft>();
  const read = (scope: string) => drafts.get(scope) ?? emptyComposerDraft;
  const clear = (scope: string) => {
    const draft = drafts.get(scope);
    if (draft !== undefined) {
      revokeDraftPreviews(draft);
      drafts.delete(scope);
    }
  };
  const update = (scope: string, applyUpdate: (draft: ComposerDraft) => ComposerDraft) => {
    const previousDraft = read(scope);
    const nextDraft = applyUpdate(previousDraft);
    revokeRemovedDraftPreviews(previousDraft, nextDraft);
    if (isEmptyComposerDraft(nextDraft)) {
      drafts.delete(scope);
    } else {
      drafts.set(scope, nextDraft);
    }
  };
  const dispose = () => {
    drafts.forEach(revokeDraftPreviews);
    drafts.clear();
  };
  return { clear, dispose, read, update };
}

export function ComposerDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const storeRef = useRef(createComposerDraftStore());
  const store = storeRef.current;

  useEffect(
    () => () => {
      // Provider 生命周期结束时统一释放仍由草稿持有的附件预览。
      store.dispose();
    },
    [store],
  );

  return <ComposerDraftContext.Provider value={store}>{children}</ComposerDraftContext.Provider>;
}

export function useComposerDraftStore(): ComposerDraftStore {
  const store = useContext(ComposerDraftContext);
  if (store === undefined) {
    throw new Error("useComposerDraftStore must be used inside ComposerDraftProvider");
  }
  return store;
}
