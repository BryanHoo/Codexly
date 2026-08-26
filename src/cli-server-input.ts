import type {
  AgentProviderConnectionRepository,
  AgentQueueRepository,
  AgentRuntimeProvider,
  AgentSettingsRepository,
  ProjectRepository,
} from "@codexly/core";
import type { CodexlyAccessOptions } from "@codexly/server";

import type { createAppUpdateService } from "./app-update.js";

export interface CreateServerInput {
  access?: CodexlyAccessOptions;
  allowedHosts?: readonly string[];
  installAppUpdate: ReturnType<typeof createAppUpdateService>["install"];
  projectRepository: ProjectRepository;
  provider: AgentRuntimeProvider;
  providerConnectionRepository: AgentProviderConnectionRepository;
  queueRepository: AgentQueueRepository;
  readAppInfo: ReturnType<typeof createAppUpdateService>["read"];
  settingsRepository: AgentSettingsRepository;
  staticRoot: string;
  temporaryWorkspace: string;
}
