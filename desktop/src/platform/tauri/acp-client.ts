import type {
  AgentQuotaView,
  AcpConfigPreview,
  AcpAgentCatalogPage,
  AcpAgentCatalogProgress,
  AcpAgentRegistration,
  AcpConfigPreviewRequest,
  AcpAgentProfile,
  AcpAuthCredentials,
  AcpAuthElicitationRequest,
  AcpAuthElicitationResponse,
  AcpConfigValues,
  AcpDefaults,
  AcpProviderConfig,
  AcpProviderPage,
  AgentEngine,
  AcpScheduledConfigView,
  SetAcpScheduledConfig,
} from "@codexly/protocol";
import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import { TauriAcpTaskClient } from "./acp-task-client.js";

/** ACP 全局端口直接走本地 IPC，与 Web 使用相同数据契约，不初始化旧厂商运行时。 */
export class TauriAcpClient extends TauriAcpTaskClient {
  getAcpAgentCatalog(
    options: ReadOptions & { refresh?: boolean; cached?: boolean } = {},
  ): Promise<AcpAgentCatalogPage> {
    return this.callCancellable(
      "acp_agent_request",
      {
        engine: "codex",
        method: "agents.list",
        params: { refresh: options.refresh ?? false, cached: options.cached ?? false },
      },
      options.signal,
    );
  }
  installAcpAgent(
    engine: AgentEngine,
    options: MutationOptions = {},
  ): Promise<AcpAgentCatalogPage> {
    return this.writeAcp(engine, "agents.install", {}, options);
  }
  updateAcpAgent(engine: AgentEngine, options: MutationOptions = {}): Promise<AcpAgentCatalogPage> {
    return this.writeAcp(engine, "agents.update", {}, options);
  }
  removeAcpAgent(engine: AgentEngine, options: MutationOptions = {}): Promise<AcpAgentCatalogPage> {
    return this.writeAcp(engine, "agents.remove", {}, options);
  }
  getAcpAgentCatalogProgress(options: ReadOptions = {}): Promise<AcpAgentCatalogProgress> {
    return this.callCancellable(
      "acp_agent_request",
      { engine: "codex", method: "agents.progress", params: {} },
      options.signal,
    );
  }
  configureAcpAgent(
    registration: AcpAgentRegistration,
    options: MutationOptions = {},
  ): Promise<AcpAgentCatalogPage> {
    return this.writeAcp(registration.engine, "agents.configure", { registration }, options);
  }
  getAcpScheduledConfig(
    taskId: string,
    options: ReadOptions = {},
  ): Promise<AcpScheduledConfigView> {
    return this.call("read_acp_scheduled_config", { taskId }, options.signal);
  }
  setAcpScheduledConfig(
    taskId: string,
    input: SetAcpScheduledConfig,
    options: MutationOptions = {},
  ): Promise<AcpScheduledConfigView> {
    return this.call("set_acp_scheduled_config", { taskId, input }, options.signal);
  }
  getAcpConfigCache(engine: AgentEngine, options: ReadOptions = {}): Promise<AcpConfigPreview | null> {
    return this.callCancellable("acp_agent_request", { engine, method: "settings.cache.read", params: {} }, options.signal);
  }
  refreshAcpConfigCache(engine: AgentEngine, options: ReadOptions = {}): Promise<AcpConfigPreview | null> {
    return this.callCancellable("acp_agent_request", { engine, method: "settings.cache.refresh", params: {} }, options.signal);
  }
  previewAcpConfig(
    projectId: string,
    engine: AgentEngine,
    input: AcpConfigPreviewRequest,
    options: ReadOptions = {},
  ): Promise<AcpConfigPreview> {
    return this.callCancellable(
      "acp_agent_request",
      { engine, method: "settings.preview", params: { ...input, projectId } },
      options.signal,
    );
  }
  getAcpAgent(engine: AgentEngine, options: ReadOptions = {}): Promise<AcpAgentProfile> {
    return this.callCancellable(
      "acp_agent_request",
      { engine, method: "agent.inspect", params: {} },
      options.signal,
    );
  }
  getAgentQuota(engine:AgentEngine, options: ReadOptions = {}): Promise<AgentQuotaView> {
    return this.callCancellable(
      "acp_agent_request",
      { engine, method: "agent.quota", params: {} },
      options.signal,
    );
  }
  getAcpDefaults(engine: AgentEngine, options: ReadOptions = {}): Promise<AcpDefaults> {
    return this.callCancellable(
      "acp_agent_request",
      { engine, method: "settings.read", params: {} },
      options.signal,
    );
  }
  getAcpProviders(engine: AgentEngine, options: ReadOptions = {}): Promise<AcpProviderPage> {
    return this.callCancellable(
      "acp_agent_request",
      { engine, method: "providers.list", params: {} },
      options.signal,
    );
  }
  authenticateAcpAgent(
    engine: AgentEngine,
    methodId: string,
    options: MutationOptions & { credentials?: AcpAuthCredentials; attemptId?: string } = {},
  ): Promise<Record<string, never>> {
    return this.callCancellable(
      "acp_agent_request",
      {
        engine,
        method: "agent.authenticate",
        params: {
          methodId,
          ...(options.credentials ? { credentials: options.credentials } : {}),
          ...(options.attemptId ? { attemptId: options.attemptId } : {}),
        },
      },
      options.signal,
    );
  }
  acpAuthElicitation(
    engine: AgentEngine,
    input: AcpAuthElicitationRequest,
    options: ReadOptions = {},
  ) {
    return this.call<AcpAuthElicitationResponse>(
      "acp_agent_request",
      { engine, method: "agent.authElicitation", params: { input } },
      options.signal,
    );
  }
  updateAcpDefaults(
    engine: AgentEngine,
    values: AcpConfigValues,
    options: MutationOptions = {},
  ): Promise<AcpDefaults> {
    return this.writeAcp(engine, "settings.write", { values }, options);
  }
  setAcpDefaultConfig(
    engine: AgentEngine,
    configId: string,
    value: string | boolean,
    options: MutationOptions = {},
  ): Promise<AcpDefaults> {
    return this.writeAcp(engine, "settings.config.write", { configId, value }, options);
  }
  configureAcpProvider(
    engine: AgentEngine,
    config: AcpProviderConfig,
    options: MutationOptions = {},
  ): Promise<AcpProviderPage> {
    return this.writeAcp(engine, "providers.set", { config }, options);
  }
  disableAcpProvider(
    engine: AgentEngine,
    providerId: string,
    options: MutationOptions = {},
  ): Promise<AcpProviderPage> {
    return this.writeAcp(engine, "providers.disable", { providerId }, options);
  }
  private async writeAcp<T>(
    engine: AgentEngine,
    method: string,
    params: object,
    options: MutationOptions,
  ): Promise<T> {
    // 提交前可以取消；已提交写入必须等待真实结果，禁止把等待取消当作未提交并自动重试。
    options.signal?.throwIfAborted();
    return this.call("acp_agent_request", { engine, method, params });
  }
}
