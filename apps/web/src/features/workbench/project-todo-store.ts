import { v4 as createUuid } from "uuid";

import type { ComposerDraft } from "./composer-draft-context.js";

export type ProjectTodoRecord = Readonly<{
  createdAt: number;
  draft: ComposerDraft;
  id: string;
  updatedAt: number;
  workingDraft?: ComposerDraft;
}>;

type ProjectTodoStoreOptions = Readonly<{
  createId?: () => string;
  now?: () => number;
}>;

type ProjectTodoStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type ProjectTodoIndexEntry = Pick<ProjectTodoRecord, "createdAt" | "id" | "updatedAt">;

export type ProjectTodoStore = Readonly<{
  create: (projectId: string, draft: ComposerDraft) => ProjectTodoRecord;
  discardWorking: (projectId: string, todoId: string) => void;
  getRevision: () => number;
  list: (projectId: string) => readonly ProjectTodoRecord[];
  read: (projectId: string, todoId: string) => ProjectTodoRecord | undefined;
  readWorking: (projectId: string, todoId: string) => ComposerDraft | undefined;
  remove: (projectId: string, todoId: string) => void;
  save: (projectId: string, todoId: string, draft: ComposerDraft) => ProjectTodoRecord | undefined;
  subscribe: (listener: () => void) => () => void;
  updateWorking: (
    projectId: string,
    todoId: string,
    draft: ComposerDraft,
  ) => ProjectTodoRecord | undefined;
}>;

const TODO_INDEX_PREFIX = "codexly:project-todos:v1:";
const TODO_RECORD_PREFIX = "codexly:project-todo:v1:";
const emptyDraft: ComposerDraft = { attachments: [], content: [] };

function defaultStorage(): ProjectTodoStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function indexKey(projectId: string): string {
  return `${TODO_INDEX_PREFIX}${projectId}`;
}

function recordKey(projectId: string, todoId: string): string {
  return `${TODO_RECORD_PREFIX}${projectId}:${todoId}`;
}

function isComposerDraft(value: unknown): value is ComposerDraft {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ComposerDraft>;
  return Array.isArray(candidate.content) && Array.isArray(candidate.attachments);
}

function isIndexEntry(value: unknown): value is ProjectTodoIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectTodoIndexEntry>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
  );
}

function isRecord(value: unknown): value is ProjectTodoRecord {
  if (!isIndexEntry(value)) return false;
  const candidate = value as Partial<ProjectTodoRecord>;
  return (
    isComposerDraft(candidate.draft) &&
    (candidate.workingDraft === undefined || isComposerDraft(candidate.workingDraft))
  );
}

function persistentDraft(draft: ComposerDraft): ComposerDraft {
  return {
    // File 不能写入 JSON；只有已稳定为服务端附件的条目进入持久层。
    attachments: draft.attachments.filter((attachment) => attachment.source === "host"),
    content: draft.content,
  };
}

function persistentRecord(record: ProjectTodoRecord): ProjectTodoRecord {
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

function readTodos(
  storage: ProjectTodoStorage | undefined,
  projectId: string,
): readonly ProjectTodoRecord[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(indexKey(projectId)) ?? "null");
    if (typeof value !== "object" || value === null) return [];
    const entries = (value as { todos?: unknown }).todos;
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(isIndexEntry)
      .map((entry) => {
        const record: unknown = JSON.parse(
          storage?.getItem(recordKey(projectId, entry.id)) ?? "null",
        );
        return isRecord(record) ? record : undefined;
      })
      .filter((record): record is ProjectTodoRecord => record !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

function writeIndex(
  storage: ProjectTodoStorage | undefined,
  projectId: string,
  todos: readonly ProjectTodoRecord[],
): void {
  if (storage === undefined) return;
  if (todos.length === 0) {
    storage.removeItem(indexKey(projectId));
    return;
  }
  storage.setItem(
    indexKey(projectId),
    JSON.stringify({
      todos: todos.map(({ createdAt, id, updatedAt }) => ({ createdAt, id, updatedAt })),
    }),
  );
}

export function createProjectTodoStore(
  storage: ProjectTodoStorage | undefined = defaultStorage(),
  options: ProjectTodoStoreOptions = {},
): ProjectTodoStore {
  const createId = options.createId ?? createUuid;
  const now = options.now ?? Date.now;
  const todosByProject = new Map<string, readonly ProjectTodoRecord[]>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const list = (projectId: string) => {
    const cached = todosByProject.get(projectId);
    if (cached !== undefined) return cached;
    const todos = readTodos(storage, projectId);
    todosByProject.set(projectId, todos);
    return todos;
  };
  const cache = (projectId: string, todos: readonly ProjectTodoRecord[], notify = true) => {
    const sorted = [...todos].sort((left, right) => right.updatedAt - left.updatedAt);
    todosByProject.set(projectId, sorted);
    if (notify) {
      revision += 1;
      listeners.forEach((listener) => {
        listener();
      });
    }
    return sorted;
  };
  const replace = (
    projectId: string,
    record: ProjectTodoRecord,
    updateIndex: boolean,
    notify = true,
  ) => {
    const todos = list(projectId);
    const exists = todos.some((candidate) => candidate.id === record.id);
    const sorted = cache(
      projectId,
      exists
        ? todos.map((candidate) => (candidate.id === record.id ? record : candidate))
        : [record, ...todos],
      notify,
    );
    storage?.setItem(recordKey(projectId, record.id), JSON.stringify(persistentRecord(record)));
    if (updateIndex) writeIndex(storage, projectId, sorted);
  };
  const read = (projectId: string, todoId: string) =>
    list(projectId).find((todo) => todo.id === todoId);
  const create = (projectId: string, draft: ComposerDraft) => {
    const timestamp = now();
    const record = {
      createdAt: timestamp,
      draft: persistentDraft(draft),
      id: createId(),
      updatedAt: timestamp,
    } satisfies ProjectTodoRecord;
    replace(projectId, record, true);
    return record;
  };
  const save = (projectId: string, todoId: string, draft: ComposerDraft) => {
    const existing = read(projectId, todoId);
    if (existing === undefined) return undefined;
    const record: ProjectTodoRecord = {
      createdAt: existing.createdAt,
      draft: persistentDraft(draft),
      id: existing.id,
      updatedAt: now(),
    };
    if (existing.workingDraft !== undefined)
      revokeRemovedPreviews(existing.workingDraft, record.draft);
    replace(projectId, record, true);
    return record;
  };
  const updateWorking = (projectId: string, todoId: string, draft: ComposerDraft) => {
    const existing = read(projectId, todoId);
    if (existing === undefined) return undefined;
    revokeRemovedPreviews(existing.workingDraft ?? existing.draft, draft);
    const record = { ...existing, workingDraft: draft } satisfies ProjectTodoRecord;
    replace(projectId, record, false, existing.workingDraft === undefined);
    return record;
  };
  const discardWorking = (projectId: string, todoId: string) => {
    const existing = read(projectId, todoId);
    if (existing?.workingDraft === undefined) return;
    revokeRemovedPreviews(existing.workingDraft, existing.draft);
    const { workingDraft: _workingDraft, ...record } = existing;
    replace(projectId, record, false);
  };
  const remove = (projectId: string, todoId: string) => {
    const todos = list(projectId);
    const removed = todos.find((todo) => todo.id === todoId);
    if (removed === undefined) return;
    if (removed.workingDraft !== undefined) revokeRemovedPreviews(removed.workingDraft, emptyDraft);
    const remaining = cache(
      projectId,
      todos.filter((todo) => todo.id !== todoId),
    );
    storage?.removeItem(recordKey(projectId, todoId));
    writeIndex(storage, projectId, remaining);
  };
  return {
    create,
    discardWorking,
    getRevision: () => revision,
    list,
    read,
    readWorking: (projectId, todoId) => read(projectId, todoId)?.workingDraft,
    remove,
    save,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateWorking,
  };
}
