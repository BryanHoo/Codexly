import type {
  TokenUsageSample,
  CodexTokenUsageSample,
  TokenUsageQuery,
  TokenUsageResponse,
} from "@codexly/protocol";
/** 应用目录与任务独立于执行引擎；sessionId 仅用于适配器恢复会话。 */
export interface LocalProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface LocalTask {
  id: string;
  projectId: string | null;
  title: string;
  /** 首条输入的持久预览；与正式名称分离，不能阻止后续自动生成。 */
  preview?: string;
  cwd: string;
  provider: string;
  sessionId: string | null;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  status: string;
}

export interface LocalTaskQuery {
  providers?: readonly ("codex" | "claude")[];
  projectId?: string | null;
  archived?: boolean;
  completed?: boolean;
  pinned?: boolean;
  searchTerm?: string;
  cursor?: string | null;
  limit?: number;
}

export interface CatalogOperations {
  "usage.record": [TokenUsageSample, undefined];
  "usage.codex": [CodexTokenUsageSample, undefined];
  "usage.query": [TokenUsageQuery, TokenUsageResponse];
  "project.list": [undefined, LocalProject[]];
  "project.put": [LocalProject, LocalProject];
  "project.read": [{ id: string }, LocalProject | null];
  "project.rename": [{ id: string; name: string }, LocalProject];
  "project.remove": [{ id: string }, boolean];
  "project.reorder": [{ ids: readonly string[] }, LocalProject[]];
  "task.put": [LocalTask, LocalTask];
  "task.read": [{ id: string }, LocalTask | null];
  "task.preview": [{ id: string; preview: string }, LocalTask];
  "task.recoverPreviews": [{ databasePath: string }, number];
  "task.bindings": [undefined, LocalTask[]];
  "task.patch": [
    Partial<Omit<LocalTask, "provider" | "projectId" | "preview">> & { id: string },
    LocalTask,
  ];
  "task.remove": [{ id: string }, boolean];
  "task.list": [LocalTaskQuery, { data: LocalTask[]; nextCursor: string | null }];
  "migration.done": [undefined, boolean];
  "migration.import": [
    { projects: (LocalProject & { sourceId?: string })[]; tasks: LocalTask[] },
    undefined,
  ];
}

export interface LocalCatalogStore {
  catalog<K extends keyof CatalogOperations>(
    operation: K,
    payload: CatalogOperations[K][0],
  ): Promise<CatalogOperations[K][1]>;
}
