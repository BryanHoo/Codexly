import { Type } from "@sinclair/typebox";
import {
  AgentQuotaViewSchema,
  AcpConfigPreviewSchema,
  type AcpBackgroundTarget,
  AcpAgentCatalogPageSchema,
  AcpAgentCatalogProgressSchema,
  type AcpAgentRegistration,
  AcpScheduledConfigViewSchema,
  type SetAcpScheduledConfig,
  type AcpAuthCredentials,
  type AcpConfigPreviewRequest,
  AcpAgentProfileSchema,
  AcpAuthenticateResponseSchema,
  AcpAuthElicitationResponseSchema,
  type AcpAuthElicitationRequest,
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
  getAcpAgentCatalog(options: ReadOptions & { refresh?: boolean } = {}) {
    return this.request(
      `/v1/acp/registry${options.refresh ? "?refresh=true" : ""}`,
      AcpAgentCatalogPageSchema,
      {},
      undefined,
      {
        ...options,
        timeoutMs: 360_000,
      },
    );
  }
  installAcpAgent(engine: AgentEngine, options: MutationOptions = {}) {
    return this.mutateAcpAgent("install", engine, options);
  }
  updateAcpAgent(engine: AgentEngine, options: MutationOptions = {}) {
    return this.mutateAcpAgent("update", engine, options);
  }
  removeAcpAgent(engine: AgentEngine, options: MutationOptions = {}) {
    return this.mutateAcpAgent("remove", engine, options);
  }
  getAcpAgentCatalogProgress(options: ReadOptions = {}) {
    return this.read("/v1/acp/registry/progress", AcpAgentCatalogProgressSchema, options);
  }
  private mutateAcpAgent(
    action: "install" | "update" | "remove",
    engine: AgentEngine,
    options: MutationOptions,
  ) {
    return this.mutation(
      `/v1/acp/registry/${action}`,
      { engine },
      AcpAgentCatalogPageSchema,
      options,
      "POST",
      360_000,
    );
  }
  configureAcpAgent(input: AcpAgentRegistration, options: MutationOptions = {}) {
    return this.mutation(
      "/v1/acp/registry/configuration",
      input,
      AcpAgentCatalogPageSchema,
      options,
      "PUT",
    );
  }
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
  cancelAcpBackground(projectId: string, taskId: string, target: AcpBackgroundTarget) {
    return this.mutation(
      `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/acp/background/cancel`,
      target,
      Type.Object({}),
      {},
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
  getAgentQuota(engine: AgentEngine, options: ReadOptions = {}) {
    return this.read(
      `/v1/acp/agents/${encodeURIComponent(engine)}/quota`,
      AgentQuotaViewSchema,
      options,
    );
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
  authenticateAcpAgent(
    engine: AgentEngine,
    methodId: string,
    options: MutationOptions & { credentials?: AcpAuthCredentials; attemptId?: string } = {},
  ) {
    return this.mutation(
      `/v1/acp/agents/${engine}/authenticate`,
      {
        methodId,
        ...(options.credentials ? { credentials: options.credentials } : {}),
        ...(options.attemptId ? { attemptId: options.attemptId } : {}),
      },
      AcpAuthenticateResponseSchema,
      options,
      "POST",
      150_000,
    );
  }
  acpAuthElicitation(
    engine: AgentEngine,
    input: AcpAuthElicitationRequest,
    options: ReadOptions = {},
  ) {
    return this.request(
      `/v1/acp/agents/${engine}/authenticate/elicitation`,
      AcpAuthElicitationResponseSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      undefined,
      options,
    );
  }
}
