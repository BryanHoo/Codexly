import { v4 as createUuid } from "uuid";

import { appPreferenceStorage } from "../../platform/tauri/app-storage.js";
import type { ComposerDraft } from "./composer-draft-context.js";

export type ProjectDraftRecord = Readonly<{
  createdAt: number;
  draft: ComposerDraft;
  id: string;
  updatedAt: number;
  workingDraft?: ComposerDraft;
}>;

type ProjectDraftStoreOptions = Readonly<{
  createId?: () => string;
  now?: () => number;
}>;

type ProjectDraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type ProjectDraftIndexEntry = Pick<ProjectDraftRecord, "createdAt" | "id" | "updatedAt">;

export type ProjectDraftStore = Readonly<{
  create: (projectId: string, draft: ComposerDraft) => ProjectDraftRecord;
  discardWorking: (projectId: string, draftId: string) => void;
  getRevision: () => number;
  list: (projectId: string) => readonly ProjectDraftRecord[];
  read: (projectId: string, draftId: string) => ProjectDraftRecord | undefined;
  readWorking: (projectId: string, draftId: string) => ComposerDraft | undefined;
  remove: (projectId: string, draftId: string) => void;
  save: (
    projectId: string,
    draftId: string,
    draft: ComposerDraft,
  ) => ProjectDraftRecord | undefined;
  subscribe: (listener: () => void) => () => void;
  updateWorking: (
    projectId: string,
    draftId: string,
    draft: ComposerDraft,
  ) => ProjectDraftRecord | undefined;
}>;

const PROJECT_DRAFT_INDEX_PREFIX = "codeagent:project-drafts:v1:";
const PROJECT_DRAFT_RECORD_PREFIX = "codeagent:project-draft:v1:";
const emptyComposerDraft: ComposerDraft = { attachments: [], content: [] };

function indexStorageKey(projectId: string): string {
  return `${PROJECT_DRAFT_INDEX_PREFIX}${projectId}`;
}

function recordStorageKey(projectId: string, draftId: string): string {
  return `${PROJECT_DRAFT_RECORD_PREFIX}${projectId}:${draftId}`;
}

function isComposerDraft(value: unknown): value is ComposerDraft {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ComposerDraft>;
  return Array.isArray(candidate.content) && Array.isArray(candidate.attachments);
}

function isProjectDraftRecord(value: unknown): value is ProjectDraftRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectDraftRecord>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    isComposerDraft(candidate.draft) &&
    (candidate.workingDraft === undefined || isComposerDraft(candidate.workingDraft))
  );
}

function isProjectDraftIndexEntry(value: unknown): value is ProjectDraftIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectDraftIndexEntry>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
  );
}

function persistentDraft(draft: ComposerDraft): ComposerDraft {
  return {
    // 浏览器 File 无法序列化；保存入口必须先将其转换为稳定的 Host 附件。
    attachments: draft.attachments.filter((attachment) => attachment.source === "host"),
    content: draft.content,
  };
}

function persistentRecord(record: ProjectDraftRecord): ProjectDraftRecord {
  return {
    ...record,
    draft: persistentDraft(record.draft),
    ...(record.workingDraft === undefined
      ? {}
      : { workingDraft: persistentDraft(record.workingDraft) }),
  };
}

function revokeRemovedPreviews(previous: ComposerDraft, next: ComposerDraft): void {
  const retained = new Set(next.attachments.map((attachment) => attachment.previewUrl));
  for (const previewUrl of new Set(
    previous.attachments.map((attachment) => attachment.previewUrl),
  )) {
    if (!retained.has(previewUrl) && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }
}

function readProjectDrafts(
  storage: ProjectDraftStorage | undefined,
  projectId: string,
): readonly ProjectDraftRecord[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(indexStorageKey(projectId)) ?? "null");
    if (typeof value !== "object" || value === null) return [];
    const drafts = (value as { drafts?: unknown }).drafts;
    if (!Array.isArray(drafts)) return [];
    return drafts
      .filter(isProjectDraftIndexEntry)
      .map((entry) => {
        const record: unknown = JSON.parse(
          storage?.getItem(recordStorageKey(projectId, entry.id)) ?? "null",
        );
        return isProjectDraftRecord(record) ? record : undefined;
      })
      .filter((record): record is ProjectDraftRecord => record !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

function writeProjectDraftIndex(
  storage: ProjectDraftStorage | undefined,
  projectId: string,
  drafts: readonly ProjectDraftRecord[],
): void {
  if (storage === undefined) return;
  if (drafts.length === 0) {
    storage.removeItem(indexStorageKey(projectId));
    return;
  }
  storage.setItem(
    indexStorageKey(projectId),
    JSON.stringify({
      drafts: drafts.map(({ createdAt, id, updatedAt }) => ({ createdAt, id, updatedAt })),
    }),
  );
}

function writeProjectDraftRecord(
  storage: ProjectDraftStorage | undefined,
  projectId: string,
  record: ProjectDraftRecord,
): void {
  storage?.setItem(recordStorageKey(projectId, record.id), JSON.stringify(persistentRecord(record)));
}

export function createProjectDraftStore(
  storage: ProjectDraftStorage | undefined = appPreferenceStorage,
  options: ProjectDraftStoreOptions = {},
): ProjectDraftStore {
  const createId = options.createId ?? createUuid;
  const now = options.now ?? Date.now;
  const draftsByProject = new Map<string, readonly ProjectDraftRecord[]>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const list = (projectId: string) => {
    const cached = draftsByProject.get(projectId);
    if (cached !== undefined) return cached;
    const drafts = readProjectDrafts(storage, projectId);
    draftsByProject.set(projectId, drafts);
    return drafts;
  };
  const cache = (
    projectId: string,
    drafts: readonly ProjectDraftRecord[],
    notify = true,
  ) => {
    const sorted = [...drafts].sort((left, right) => right.updatedAt - left.updatedAt);
    draftsByProject.set(projectId, sorted);
    if (notify) {
      revision += 1;
      listeners.forEach((listener) => listener());
    }
    return sorted;
  };
  const replaceRecord = (
    projectId: string,
    record: ProjectDraftRecord,
    updateIndex: boolean,
    notify = true,
  ) => {
    const drafts = list(projectId);
    const exists = drafts.some((candidate) => candidate.id === record.id);
    const sorted = cache(
      projectId,
      exists
        ? drafts.map((candidate) => (candidate.id === record.id ? record : candidate))
        : [record, ...drafts],
      notify,
    );
    writeProjectDraftRecord(storage, projectId, record);
    if (updateIndex) writeProjectDraftIndex(storage, projectId, sorted);
  };
  const read = (projectId: string, draftId: string) =>
    list(projectId).find((draft) => draft.id === draftId);
  const readWorking = (projectId: string, draftId: string) =>
    read(projectId, draftId)?.workingDraft;
  const create = (projectId: string, draft: ComposerDraft) => {
    const timestamp = now();
    const record: ProjectDraftRecord = {
      createdAt: timestamp,
      draft: persistentDraft(draft),
      id: createId(),
      updatedAt: timestamp,
    };
    replaceRecord(projectId, record, true);
    return record;
  };
  const save = (projectId: string, draftId: string, draft: ComposerDraft) => {
    const existing = read(projectId, draftId);
    if (existing === undefined) return undefined;
    const record: ProjectDraftRecord = {
      createdAt: existing.createdAt,
      draft: persistentDraft(draft),
      id: existing.id,
      updatedAt: now(),
    };
    if (existing.workingDraft !== undefined) {
      revokeRemovedPreviews(existing.workingDraft, record.draft);
    }
    replaceRecord(projectId, record, true);
    return record;
  };
  const updateWorking = (projectId: string, draftId: string, draft: ComposerDraft) => {
    const existing = read(projectId, draftId);
    if (existing === undefined) return undefined;
    const previousDraft = existing.workingDraft ?? existing.draft;
    const record: ProjectDraftRecord = {
      ...existing,
      workingDraft: draft,
    };
    revokeRemovedPreviews(previousDraft, draft);
    replaceRecord(projectId, record, false, existing.workingDraft === undefined);
    return record;
  };
  const discardWorking = (projectId: string, draftId: string) => {
    const existing = read(projectId, draftId);
    if (existing?.workingDraft === undefined) return;
    revokeRemovedPreviews(existing.workingDraft, existing.draft);
    const { workingDraft: _workingDraft, ...record } = existing;
    replaceRecord(projectId, record, false);
  };
  const remove = (projectId: string, draftId: string) => {
    const drafts = list(projectId);
    const removed = drafts.find((draft) => draft.id === draftId);
    if (removed === undefined) return;
    if (removed.workingDraft !== undefined) {
      revokeRemovedPreviews(removed.workingDraft, emptyComposerDraft);
    }
    const remaining = cache(
      projectId,
      drafts.filter((draft) => draft.id !== draftId),
    );
    storage?.removeItem(recordStorageKey(projectId, draftId));
    writeProjectDraftIndex(storage, projectId, remaining);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    create,
    discardWorking,
    getRevision: () => revision,
    list,
    read,
    readWorking,
    remove,
    save,
    subscribe,
    updateWorking,
  };
}
