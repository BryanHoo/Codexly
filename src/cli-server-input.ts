import type {
  AsyncQuestionRepository,
  ProjectTodoRepository,
  TaskSubmissionRepository,
} from "@codexly/core";
import type {
  AgentProviderConnectionRepository,
  AgentQueueRepository,
  AgentRuntimeProvider,
  AgentSettingsRepository,
  ProjectRepository,
  ScheduledTaskAttachmentRepository,
  ScheduledTaskRepository,
  WorkbenchPetProvider,
} from "@codexly/core";
import type { CodexlyAccessOptions } from "@codexly/server";

import type { createAppUpdateService } from "./app-update.js";

export interface CreateServerInput {
  asyncQuestionRepository: AsyncQuestionRepository;
  projectTodoRepository: ProjectTodoRepository;
  submissionRepository: TaskSubmissionRepository;
  access?: CodexlyAccessOptions;
  allowedHosts?: readonly string[];
  installAppUpdate: ReturnType<typeof createAppUpdateService>["install"];
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
  preloadModelCatalog?: boolean;
  petProvider: WorkbenchPetProvider;
  providerConnectionRepository: AgentProviderConnectionRepository;
  queueRepository: AgentQueueRepository;
  scheduledTaskAttachmentRepository: ScheduledTaskAttachmentRepository;
  scheduledTaskRepository: ScheduledTaskRepository;
  readAppInfo: ReturnType<typeof createAppUpdateService>["read"];
  readAppUpdateProgress: ReturnType<typeof createAppUpdateService>["readProgress"];
  settingsRepository: AgentSettingsRepository;
  staticRoot: string;
  standaloneCwd: string;
  workspaceRoots?: readonly string[];
}
