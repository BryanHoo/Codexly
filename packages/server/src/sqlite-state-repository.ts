import type {
  CatalogOperations,
  AgentQueueRecord,
  AgentQueueRepository,
  AgentProviderConnectionRepository,
  AgentSettingsRepository,
  ProjectProjectionStore,
  ProjectSourceMigration,
} from "@codexly/core";
import type {
  AgentPromptInput,
  AgentQueuedSubmissionStatus,
  AgentProviderConnectionRecord,
  AgentGlobalSettings,
  AgentProjectDefaults,
  AgentTaskSettings,
  Project,
} from "@codexly/protocol";

import {
  parseProviderConnectionRow,
  serializeProviderConnectionRecord,
  type ProviderConnectionRow,
} from "./provider-connection-persistence.js";
import {
  SqliteStateWorkerClient,
  type SqliteStateWorkerOptions,
} from "./sqlite-state-worker-client.js";
import { SqliteAsyncQuestionRepository } from "./async-question-repository.js";
import { parseQueueWorkerRecord, type QueueWorkerRecord } from "./queue-record-persistence.js";

export type { SqliteMigration } from "./sqlite-state-migrations.js";

export type SqliteDatabaseDiagnostics = Readonly<{
  busyTimeout: number;
  foreignKeys: boolean;
  integrityCheck: string;
  journalMode: string;
  migrationVersion: number;
  synchronous: string;
  writable: boolean;
}>;

export interface SqliteStateRepositoryOptions extends SqliteStateWorkerOptions {
  now?: () => Date;
}

export class SqliteStateRepository
  extends SqliteAsyncQuestionRepository
  implements
    ProjectProjectionStore,
    AgentSettingsRepository,
    AgentProviderConnectionRepository,
    AgentQueueRepository
{
  readonly #workerClient: SqliteStateWorkerClient;
  readonly #now: () => Date;

  private constructor(workerClient: SqliteStateWorkerClient, now: () => Date) {
    super();
    this.#workerClient = workerClient;
    this.#now = now;
  }

  public static async open(
    databasePath: string,
    options: SqliteStateRepositoryOptions = {},
  ): Promise<SqliteStateRepository> {
    const workerClient = await SqliteStateWorkerClient.open(databasePath, options);
    return new SqliteStateRepository(workerClient, options.now ?? (() => new Date()));
  }

  public close(): Promise<void> {
    return this.#workerClient.close();
  }

  public diagnose(): Promise<SqliteDatabaseDiagnostics> {
    return this.#call("diagnose");
  }

  public list(): Promise<readonly Project[]> {
    return this.#call("listProjects");
  }

  public catalog<K extends keyof CatalogOperations>(
    operation: K,
    payload: CatalogOperations[K][0],
  ): Promise<CatalogOperations[K][1]> {
    return this.#call("localCatalog", { operation, payload });
  }

  public completeProjectSourceMigration(): Promise<void> {
    return this.#call("completeProjectSourceMigration");
  }

  public migrateProject(legacyProjectId: string, project: Project): Promise<Project> {
    return this.#call("migrateProject", { legacyProjectId, project });
  }

  public read(projectId: string): Promise<Project | undefined> {
    return this.#call("readProject", { projectId });
  }

  public readProjectSourceMigration(): Promise<ProjectSourceMigration> {
    return this.#call("readProjectSourceMigration");
  }

  public replaceProjects(projects: readonly Project[]): Promise<readonly Project[]> {
    return this.#call("replaceProjects", { projects });
  }

  public upsertProject(project: Project): Promise<Project> {
    return this.#call("upsertProject", { project });
  }

  public deleteProject(projectId: string): Promise<boolean> {
    return this.#call("deleteProject", { projectId });
  }

  public setProjectOrder(projectIds: readonly string[]): Promise<readonly Project[]> {
    return this.#call("setProjectOrder", { projectIds });
  }

  public async addQueue(record: AgentQueueRecord): Promise<AgentQueueRecord> {
    const { input, ...metadata } = record;
    return parseQueueWorkerRecord(
      await this.#call("addTaskQueueRecord", {
        ...metadata,
        inputJson: JSON.stringify(input),
        updatedAt: this.#now().toISOString(),
      }),
    );
  }

  public setQueueExecution(
    record: AgentQueueRecord,
    execution: NonNullable<AgentQueueRecord["execution"]>,
  ): Promise<boolean> {
    return this.#call("setTaskQueueExecution", {
      projectId: record.projectId,
      taskId: record.taskId,
      id: record.id,
      executionJson: JSON.stringify(execution),
      claim: execution.state === "starting",
    });
  }

  public deleteQueue(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
  ): Promise<boolean> {
    return this.#call("deleteTaskQueueRecord", { projectId, queuedSubmissionId, taskId });
  }

  public async listQueue(projectId: string, taskId: string): Promise<readonly AgentQueueRecord[]> {
    const records = await this.#call<readonly QueueWorkerRecord[]>("listTaskQueueRecords", {
      projectId,
      taskId,
    });
    return records.map(parseQueueWorkerRecord);
  }

  public reorderQueue(
    projectId: string,
    taskId: string,
    queuedSubmissionIds: readonly string[],
  ): Promise<void> {
    return this.#call("reorderTaskQueueRecords", { projectId, queuedSubmissionIds, taskId });
  }

  public async updateQueue(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    input: AgentPromptInput,
    status: AgentQueuedSubmissionStatus,
  ): Promise<AgentQueueRecord | undefined> {
    const record = await this.#call<QueueWorkerRecord | undefined>("updateTaskQueueRecord", {
      inputJson: JSON.stringify(input),
      projectId,
      queuedSubmissionId,
      status,
      taskId,
      updatedAt: this.#now().toISOString(),
    });
    return record === undefined ? undefined : parseQueueWorkerRecord(record);
  }

  public readProjectDefaults(projectId: string): Promise<AgentProjectDefaults | undefined> {
    return this.#call("readProjectDefaults", { projectId });
  }

  public async readProviderConnection(): Promise<AgentProviderConnectionRecord | undefined> {
    const row = await this.#call<ProviderConnectionRow | undefined>("readProviderConnection");
    // Worker 只负责数据库访问，所有持久化 JSON 在类型边界统一校验。
    return parseProviderConnectionRow(row);
  }

  public readGlobalSettings(): Promise<AgentGlobalSettings | undefined> {
    return this.#call("readGlobalSettings");
  }

  public readTaskSettings(
    projectId: string,
    taskId: string,
  ): Promise<AgentTaskSettings | undefined> {
    return this.#call("readTaskSettings", { projectId, taskId });
  }

  public writeProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
  ): Promise<AgentProjectDefaults> {
    return this.#call("writeProjectDefaults", {
      projectId,
      settings,
      updatedAt: this.#now().toISOString(),
    });
  }

  public async writeProviderConnection(
    record: AgentProviderConnectionRecord,
  ): Promise<AgentProviderConnectionRecord> {
    const customModelsJson = serializeProviderConnectionRecord(record);
    await this.#call("writeProviderConnection", {
      customBaseUrl: record.customBaseUrl,
      customModelsJson,
      mode: record.mode,
      updatedAt: record.updatedAt,
    });
    return record;
  }

  public writeGlobalSettings(settings: AgentGlobalSettings): Promise<AgentGlobalSettings> {
    return this.#call("writeGlobalSettings", {
      settings,
      updatedAt: this.#now().toISOString(),
    });
  }

  public writeTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
  ): Promise<AgentTaskSettings> {
    return this.#call("writeTaskSettings", {
      projectId,
      settings,
      taskId,
      updatedAt: this.#now().toISOString(),
    });
  }

  protected callScheduledTaskWorker<TResult>(
    operation: string,
    payload?: unknown,
  ): Promise<TResult> {
    return this.#call<TResult>(operation, payload);
  }

  #call<TResult>(operation: string, payload?: unknown): Promise<TResult> {
    return this.#workerClient.call<TResult>(operation, payload);
  }
}
