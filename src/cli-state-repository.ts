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
