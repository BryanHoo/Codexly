import type { CodexlyClient } from "@codexly/client";
import { buildProjectAttachmentUrl } from "@codexly/client";
import type { ProjectTodo, ProjectTodoDraft } from "@codexly/protocol";
import type { QueryClient } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import type { ComposerDraft } from "./composer-draft-context.js";

export type ProjectTodoRecord = Omit<ProjectTodo, "draft"> &
  Readonly<{ draft: ComposerDraft; workingDraft?: ComposerDraft }>;
export type ProjectTodoClient = Pick<
  CodexlyClient,
  "createProjectTodo" | "listProjectTodos" | "saveProjectTodo" | "deleteProjectTodo"
>;
export const projectTodoQueryKey = (projectId: string) => ["projects", projectId, "todos"] as const;
export function projectTodoQueryOptions(
  projectId: string,
  client: ProjectTodoClient,
  prepareProject?: (id: string) => Promise<void>,
) {
  return {
    queryKey: projectTodoQueryKey(projectId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      await prepareProject?.(projectId);
      return client.listProjectTodos(projectId, { signal });
    },
    // 跨设备变更通过可见页面刷新与聚焦校准；后台页面不执行轮询。
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  };
}

function toPersistentDraft(draft: ComposerDraft): ProjectTodoDraft {
  return {
    content: [...draft.content],
    attachments: draft.attachments.map((item) => {
      if (item.source !== "host")
        throw new Error("Upload attachments before saving a project todo");
      return {
        id: item.id,
        kind: item.kind,
        mediaType: item.mediaType,
        name: item.name,
        size: item.size,
      };
    }),
  };
}

function toRecord(todo: ProjectTodo): ProjectTodoRecord {
  return {
    ...todo,
    draft: {
      content: todo.draft.content,
      attachments: todo.draft.attachments.map((attachment) => ({
        ...attachment,
        attachment,
        source: "host" as const,
        previewUrl: buildProjectAttachmentUrl("", todo.projectId, attachment.id),
      })),
    },
  };
}

function releasePreviews(draft: ComposerDraft | undefined, retained?: ComposerDraft) {
  const kept = new Set(retained?.attachments.map((item) => item.previewUrl));
  for (const item of draft?.attachments ?? [])
    if (item.previewUrl.startsWith("blob:") && !kept.has(item.previewUrl))
      URL.revokeObjectURL(item.previewUrl);
}

export function createProjectTodoStore({
  client,
  queryClient,
  prepareProject,
}: {
  client: ProjectTodoClient;
  queryClient: QueryClient;
  prepareProject?: (id: string) => Promise<void>;
}) {
  const working = new Map<string, ProjectTodoRecord>();
  const views = new Map<
    string,
    { data: readonly ProjectTodo[]; revision: number; records: readonly ProjectTodoRecord[] }
  >();
  const listeners = new Set<() => void>();
  const attempts = new Map<string, { fingerprint: string; key: string }>();
  const empty: readonly ProjectTodo[] = [];
  let revision = 0;
  let workingRevision = 0;
  let unsubscribe: (() => void) | undefined;
  const scope = (projectId: string, todoId: string) => JSON.stringify([projectId, todoId]);
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  const changedDraft = () => {
    workingRevision++;
    notify();
  };
  const list = (projectId: string): readonly ProjectTodoRecord[] => {
    const data =
      queryClient.getQueryData<{ data: ProjectTodo[] }>(projectTodoQueryKey(projectId))?.data ??
      empty;
    const cached = views.get(projectId);
    if (cached?.data === data && cached.revision === workingRevision) return cached.records;
    const records = data.map((todo) => working.get(scope(projectId, todo.id)) ?? toRecord(todo));
    views.set(projectId, { data, revision: workingRevision, records });
    return records;
  };
  const read = (projectId: string, todoId: string) =>
    list(projectId).find((todo) => todo.id === todoId);
  const mutate = async <T>(id: string, payload: unknown, action: (key: string) => Promise<T>) => {
    const fingerprint = JSON.stringify(payload);
    let attempt = attempts.get(id);
    if (attempt?.fingerprint !== fingerprint) {
      attempt = { fingerprint, key: createUuid() };
      attempts.set(id, attempt);
    }
    const result = await action(attempt.key);
    attempts.delete(id);
    return result;
  };
  const discardWorking = (projectId: string, todoId: string) => {
    const id = scope(projectId, todoId);
    releasePreviews(working.get(id)?.workingDraft);
    if (working.delete(id)) changedDraft();
  };
  return {
    client,
    queryOptions: (projectId: string) => projectTodoQueryOptions(projectId, client, prepareProject),
    getRevision: () => revision,
    list,
    read,
    readWorking: (projectId: string, todoId: string) =>
      working.get(scope(projectId, todoId))?.workingDraft,
    async create(projectId: string, draft: ComposerDraft) {
      const persisted = toPersistentDraft(draft);
      const { todo, todos } = await mutate(`create:${projectId}`, persisted, (key) =>
        client.createProjectTodo(projectId, persisted, { idempotencyKey: key }),
      );
      queryClient.setQueryData(projectTodoQueryKey(projectId), todos);
      return toRecord(todo);
    },
    async save(projectId: string, todoId: string, draft: ComposerDraft) {
      const existing = read(projectId, todoId);
      if (existing === undefined) throw new Error("Project todo is unavailable");
      const input = { draft: toPersistentDraft(draft), expectedVersion: existing.version };
      const { todo, todos } = await mutate(`save:${scope(projectId, todoId)}`, input, (key) =>
        client.saveProjectTodo(projectId, todoId, input, { idempotencyKey: key }),
      );
      discardWorking(projectId, todoId);
      queryClient.setQueryData(projectTodoQueryKey(projectId), todos);
      return toRecord(todo);
    },
    async remove(projectId: string, todoId: string) {
      const existing = read(projectId, todoId);
      if (existing === undefined) return;
      const { todos } = await mutate(
        `delete:${scope(projectId, todoId)}`,
        existing.version,
        (key) =>
          client.deleteProjectTodo(projectId, todoId, existing.version, { idempotencyKey: key }),
      );
      discardWorking(projectId, todoId);
      queryClient.setQueryData(projectTodoQueryKey(projectId), todos);
    },
    discardWorking,
    updateWorking(projectId: string, todoId: string, draft: ComposerDraft) {
      const existing = read(projectId, todoId);
      if (existing === undefined) return undefined;
      releasePreviews(existing.workingDraft, draft);
      // 编辑副本固定原始版本；远端刷新不能偷偷推进版本并覆盖其他设备的修改。
      const record = { ...existing, workingDraft: draft };
      working.set(scope(projectId, todoId), record);
      changedDraft();
      return record;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      unsubscribe ??= queryClient.getQueryCache().subscribe((event) => {
        // 观察器每次渲染都会更新选项，不能因此推进外部 Store 版本并触发下一次渲染。
        if (event.type !== "updated" && event.type !== "removed") return;
        const key = event.query.queryKey as readonly unknown[];
        if (key[2] !== "todos") return;
        if (event.type === "removed") views.delete(String(key[1]));
        notify();
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      };
    },
  };
}
export type ProjectTodoStore = ReturnType<typeof createProjectTodoStore>;
