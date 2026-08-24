import { isAbsolute } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  AgentProviderConnectionRepository,
  AgentSettingsRepository,
  ProjectProjectionStore,
  ProjectSourceMigration,
} from "@code-agent/core";
import type {
  AgentProviderConnectionRecord,
  AgentGlobalSettings,
  AgentProjectDefaults,
  AgentTaskSettings,
  Project,
} from "@code-agent/protocol";

import {
  parseProviderConnectionRow,
  serializeProviderConnectionRecord,
  type ProviderConnectionRow,
} from "./provider-connection-persistence.js";
import { deserializeWorkerError } from "./sqlite-state-helpers.js";
import { SQLITE_MIGRATIONS, type SqliteMigration } from "./sqlite-state-migrations.js";

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

export interface SqliteStateRepositoryOptions {
  migrations?: readonly SqliteMigration[];
  now?: () => Date;
  requestTimeoutMs?: number;
  workerUrl?: URL;
}

const DEFAULT_SQLITE_REQUEST_TIMEOUT_MS = 10_000;

type WorkerResponse =
  | Readonly<{ error: Readonly<{ message: string; name: string }>; id: number; type: "response" }>
  | Readonly<{ id: number; result: unknown; type: "response" }>
  | Readonly<{ error: Readonly<{ message: string; name: string }>; type: "fatal" }>
  | Readonly<{ type: "ready" }>;

type PendingRequest = Readonly<{
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}>;

export class SqliteStateRepository
  implements ProjectProjectionStore, AgentSettingsRepository, AgentProviderConnectionRepository
{
  readonly #now: () => Date;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #ready: Promise<void>;
  readonly #requestTimeoutMs: number;
  readonly #worker: Worker;
  readonly #workerExit: Promise<number>;
  #closed = false;
  #nextRequestId = 1;
  #workerExited = false;

  private constructor(databasePath: string, options: SqliteStateRepositoryOptions) {
    if (!isAbsolute(databasePath)) {
      throw new Error("SQLite database path must be absolute");
    }
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_SQLITE_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new RangeError("SQLite request timeout must be a positive number");
    }
    this.#now = options.now ?? (() => new Date());
    this.#worker = new Worker(
      options.workerUrl ?? new URL("./sqlite-state-worker.js", import.meta.url),
      {
        workerData: {
          databasePath,
          migrations: options.migrations ?? SQLITE_MIGRATIONS,
        },
      },
    );
    this.#workerExit = new Promise<number>((resolveExit) => {
      this.#worker.once("exit", (code) => {
        this.#workerExited = true;
        resolveExit(code);
      });
    });
    this.#ready = new Promise<void>((resolveReady, rejectReady) => {
      let readySettled = false;
      const readyTimeout = setTimeout(() => {
        settleReadyError(
          new Error(
            `SQLite worker initialization timed out after ${String(this.#requestTimeoutMs)}ms`,
          ),
        );
      }, this.#requestTimeoutMs);
      const settleReady = (): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        resolveReady();
      };
      const settleReadyError = (error: Error): void => {
        if (readySettled) {
          return;
        }
        readySettled = true;
        clearTimeout(readyTimeout);
        rejectReady(error);
      };
      const onMessage = (message: WorkerResponse): void => {
        if (message.type === "ready") {
          settleReady();
          return;
        }
        if (message.type === "fatal") {
          settleReadyError(deserializeWorkerError(message.error));
          return;
        }
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(message.id);
        clearTimeout(pending.timeout);
        if ("error" in message) {
          pending.reject(deserializeWorkerError(message.error));
        } else {
          pending.resolve(message.result);
        }
      };
      this.#worker.on("message", onMessage);
      this.#worker.once("error", (error: unknown) => {
        const workerError = error instanceof Error ? error : new Error(String(error));
        settleReadyError(workerError);
        this.#rejectPending(workerError);
      });
      this.#worker.once("exit", (code) => {
        const workerError = new Error(`SQLite worker exited with code ${String(code)}`);
        settleReadyError(workerError);
        if (!this.#closed || this.#pending.size > 0) {
          this.#rejectPending(workerError);
        }
      });
    });
  }

  public static async open(
    databasePath: string,
    options: SqliteStateRepositoryOptions = {},
  ): Promise<SqliteStateRepository> {
    const repository = new SqliteStateRepository(databasePath, options);
    try {
      await repository.#ready;
      return repository;
    } catch (error) {
      repository.#closed = true;
      await repository.#worker.terminate();
      repository.#rejectPending(
        error instanceof Error ? error : new Error("SQLite worker initialization failed"),
      );
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      await this.#call("close", undefined, true);
      await this.#waitForWorkerExit();
    } finally {
      if (!this.#workerExited) {
        await this.#worker.terminate();
      }
      this.#rejectPending(new Error("SQLite repository is closed"));
    }
  }

  public diagnose(): Promise<SqliteDatabaseDiagnostics> {
    return this.#call("diagnose");
  }

  public list(): Promise<readonly Project[]> {
    return this.#call("listProjects");
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

  async #call<TResult>(
    operation: string,
    payload?: unknown,
    allowClosed = false,
  ): Promise<TResult> {
    await this.#ready;
    if (this.#closed && !allowClosed) {
      throw new Error("SQLite repository is closed");
    }
    const id = this.#nextRequestId++;
    return new Promise<TResult>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.has(id)) {
          return;
        }
        const error = new Error(
          `SQLite worker operation ${operation} timed out after ${String(this.#requestTimeoutMs)}ms`,
        );
        // 超时后无法确认 Worker 是否仍会写入，终止整个 Repository 避免继续使用未知状态。
        this.#closed = true;
        this.#rejectPending(error);
        void this.#worker.terminate();
      }, this.#requestTimeoutMs);
      this.#pending.set(id, {
        reject: rejectRequest,
        resolve: (value) => {
          resolveRequest(value as TResult);
        },
        timeout,
      });
      try {
        this.#worker.postMessage({ id, operation, payload });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timeout);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async #waitForWorkerExit(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        this.#workerExit,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `SQLite worker shutdown timed out after ${String(this.#requestTimeoutMs)}ms`,
              ),
            );
          }, this.#requestTimeoutMs);
        }),
      ]);
      if (code !== 0) {
        throw new Error(`SQLite worker exited with code ${String(code)} during shutdown`);
      }
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
