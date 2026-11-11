import {
  AcpConfigPreviewSchema,
  AcpScheduledConfigViewSchema,
  type SetAcpScheduledConfig,
  type AcpConfigPreviewRequest,
  AcpAgentProfileSchema,
  AcpAuthenticateResponseSchema,
  AcpDefaultsSchema,
  AcpSessionConfigSchema,
  AcpSessionStateSchema,
  AcpProviderPageSchema,
  type AcpProviderConfig,
  type AcpConfigValues,
  type AgentEngine,
} from "@codexly/protocol";
import { AsyncQuestionHttpClient } from "./http-client-async-questions.js";
import { projectPath, type MutationOptions, type ReadOptions } from "./http-client-transport.js";

/** ACP 设置与认证统一复用配对、错误解码、取消和幂等传输。 */
export class AcpHttpClient extends AsyncQuestionHttpClient {
  getAcpScheduledConfig(taskId: string, options: ReadOptions = {}) {
    return this.read(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}/acp-config`,
      AcpScheduledConfigViewSchema,
      options,
    );
  }
  setAcpScheduledConfig(
    taskId: string,
    input: SetAcpScheduledConfig,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `/v1/scheduled-tasks/${encodeURIComponent(taskId)}/acp-config`,
      input,
      AcpScheduledConfigViewSchema,
      options,
      "PUT",
    );
  }
  previewAcpConfig(
    projectId: string,
    engine: AgentEngine,
    input: AcpConfigPreviewRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${projectPath(projectId)}/acp/${engine}/preview`,
      input,
      AcpConfigPreviewSchema,
      options,
      "POST",
    );
  }
  getAcpSessionState(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/acp/session`,
      AcpSessionStateSchema,
      options,
    );
  }
  getAcpProviders(engine: AgentEngine, options: ReadOptions = {}) {
    return this.read(`/v1/acp/agents/${engine}/providers`, AcpProviderPageSchema, options);
  }
  configureAcpProvider(
    engine: AgentEngine,
    config: AcpProviderConfig,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `/v1/acp/agents/${engine}/providers`,
      config,
      AcpProviderPageSchema,
      options,
      "PUT",
    );
  }
  disableAcpProvider(engine: AgentEngine, providerId: string, options: MutationOptions = {}) {
    return this.mutation(
      `/v1/acp/agents/${engine}/providers/${encodeURIComponent(providerId)}`,
      {},
      AcpProviderPageSchema,
      options,
      "DELETE",
    );
  }
  getAcpSessionConfig(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(
      `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/acp/config`,
      AcpSessionConfigSchema,
      options,
    );
  }
  setAcpSessionConfig(
    projectId: string,
    taskId: string,
    configId: string,
    value: string | boolean,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/acp/config`,
      { configId, value },
      AcpSessionConfigSchema,
      options,
      "PUT",
    );
  }
  getAcpAgent(engine: AgentEngine, options: ReadOptions = {}) {
    return this.read(`/v1/acp/agents/${engine}`, AcpAgentProfileSchema, options);
  }
  getAcpDefaults(engine: AgentEngine, options: ReadOptions = {}) {
    return this.read(`/v1/acp/agents/${engine}/defaults`, AcpDefaultsSchema, options);
  }
  updateAcpDefaults(engine: AgentEngine, values: AcpConfigValues, options: MutationOptions = {}) {
    return this.mutation(
      `/v1/acp/agents/${engine}/defaults`,
      { values },
      AcpDefaultsSchema,
      options,
      "PUT",
    );
  }
  setAcpDefaultConfig(
    engine: AgentEngine,
    configId: string,
    value: string | boolean,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `/v1/acp/agents/${engine}/defaults`,
      { configId, value },
      AcpDefaultsSchema,
      options,
      "PATCH",
    );
  }
  authenticateAcpAgent(engine: AgentEngine, methodId: string, options: MutationOptions = {}) {
    return this.mutation(
      `/v1/acp/agents/${engine}/authenticate`,
      { methodId },
      AcpAuthenticateResponseSchema,
      options,
      "POST",
      150_000,
    );
  }
}
