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

export type ComposerDraftStore = Readonly<{
  clear: (scope: string) => void;
  dispose: () => void;
  read: (scope: string) => ComposerDraft;
  update: (scope: string, update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

type DraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
const DRAFT_STORAGE_PREFIX = "codexly:composer-draft:v1:";

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

function defaultDraftStorage(): DraftStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readPersistedDraft(
  storage: DraftStorage | undefined,
  scope: string,
): ComposerDraft | undefined {
  try {
    const value: unknown = JSON.parse(
      storage?.getItem(`${DRAFT_STORAGE_PREFIX}${scope}`) ?? "null",
    );
    if (typeof value !== "object" || value === null) return undefined;
    const candidate = value as Partial<ComposerDraft>;
    if (!Array.isArray(candidate.content) || !Array.isArray(candidate.attachments))
      return undefined;
    return candidate as ComposerDraft;
  } catch {
    return undefined;
  }
}

function writePersistedDraft(
  storage: DraftStorage | undefined,
  scope: string,
  draft: ComposerDraft | undefined,
): void {
  if (storage === undefined) return;
  const key = `${DRAFT_STORAGE_PREFIX}${scope}`;
  if (draft === undefined) {
    storage.removeItem(key);
    return;
  }
  // 浏览器 File 不能安全序列化；已导入的 Host 附件使用稳定随机 ID，可随草稿恢复。
  storage.setItem(
    key,
    JSON.stringify({
      attachments: draft.attachments.filter((attachment) => attachment.source === "host"),
      content: draft.content,
    }),
  );
}

export function createComposerDraftStore(storage = defaultDraftStorage()): ComposerDraftStore {
  const drafts = new Map<string, ComposerDraft>();
  const read = (scope: string) => {
    const existing = drafts.get(scope);
    if (existing !== undefined) return existing;
    const persisted = readPersistedDraft(storage, scope);
    if (persisted !== undefined) drafts.set(scope, persisted);
    return persisted ?? emptyComposerDraft;
  };
  const clear = (scope: string) => {
    const draft = drafts.get(scope);
    if (draft !== undefined) {
      revokeDraftPreviews(draft);
      drafts.delete(scope);
    }
    writePersistedDraft(storage, scope, undefined);
  };
  const update = (scope: string, applyUpdate: (draft: ComposerDraft) => ComposerDraft) => {
    const previousDraft = read(scope);
    const nextDraft = applyUpdate(previousDraft);
    revokeRemovedDraftPreviews(previousDraft, nextDraft);
    if (isEmptyComposerDraft(nextDraft)) {
      drafts.delete(scope);
      writePersistedDraft(storage, scope, undefined);
    } else {
      drafts.set(scope, nextDraft);
      writePersistedDraft(storage, scope, nextDraft);
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
