import type {
  AsyncQuestionRepository,
  AgentSettingsRepository,
  AgentProviderConnectionRepository,
  AgentQueueRepository,
  TaskSubmissionRepository,
  ProjectTodoRepository,
  ProjectProjectionStore,
  ScheduledTaskAttachmentRepository,
  ScheduledTaskRepository,
} from "@codexly/core";
import type { SqliteDatabaseDiagnostics } from "@codexly/server";

export interface CliManagedStateRepository
  extends
    ProjectProjectionStore,
    AgentSettingsRepository,
    AgentProviderConnectionRepository,
    AgentQueueRepository,
    TaskSubmissionRepository,
    AsyncQuestionRepository,
    ProjectTodoRepository,
    ScheduledTaskAttachmentRepository,
    ScheduledTaskRepository {
  close: () => Promise<void>;
  diagnose: () => Promise<SqliteDatabaseDiagnostics>;
}

export function assertDatabaseDiagnostics(diagnostics: SqliteDatabaseDiagnostics): void {
  if (!diagnostics.writable) {
    throw new Error("SQLite database is not writable");
  }
  if (diagnostics.migrationVersion < 1) {
    throw new Error("SQLite migrations are not applied");
  }
  if (diagnostics.integrityCheck !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${diagnostics.integrityCheck}`);
  }
  if (diagnostics.journalMode.toLocaleLowerCase() !== "wal") {
    throw new Error(`SQLite journal_mode must be WAL; found ${diagnostics.journalMode}`);
  }
  if (
    !diagnostics.foreignKeys ||
    diagnostics.synchronous !== "normal" ||
    diagnostics.busyTimeout !== 5_000
  ) {
    throw new Error("SQLite PRAGMA configuration is invalid");
  }
}
