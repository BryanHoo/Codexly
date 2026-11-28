import type { AgentThreadMemory } from "@codexly/protocol";
import type { HistoryCompressionResult } from "@codexly/protocol";
import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import type {
  AgentGlobalSettings,
  AgentGlobalSettingsResponse,
  AgentMcpServerPage,
  ReloadAgentMcpServersRequest,
  AgentModelPage,
  AgentProjectDefaults,
  AgentProjectDefaultsResponse,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentSkillPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  StartOfficialProviderLoginResponse,
} from "@/protocol/index.js";

import { TauriApplicationPreferencesClient } from "./application-preferences-client.js";
import type { MemorySettings, MemorySettingsUpdate } from "@/protocol/index.js";

export class TauriCatalogClient extends TauriApplicationPreferencesClient {
  public async readThreadMemory(projectId: string, taskId: string, options: ReadOptions = {}): Promise<AgentThreadMemory> {
    return this.callCancellable("read_thread_memory", { projectId, taskId }, options.signal);
  }


  public async compressHistory(): Promise<HistoryCompressionResult> {
    return this.call("compress_history");
  }

  public async getMemorySettings(): Promise<MemorySettings> {
    const { parseMemories } = await import("./personalization-response.js");
    return parseMemories(await this.call("get_memory_settings"));
  }

  public async updateMemorySettings(update: MemorySettingsUpdate): Promise<MemorySettings> {
    const { parseMemories } = await import("./personalization-response.js");
    return parseMemories(await this.call("update_memory_settings", { update }));
  }

  public async resetMemories(): Promise<void> {
    await this.call("reset_memories");
  }

  public async listModels(_options: ReadOptions = {}): Promise<AgentModelPage> {
    return this.call("list_models");
  }

  public async getProviderConnection(
    _options: ReadOptions = {},
  ): Promise<AgentProviderConnectionStatus> {
    return this.call("get_provider_connection");
  }

  public async startOfficialProviderLogin(
    _options: MutationOptions = {},
  ): Promise<StartOfficialProviderLoginResponse> {
    return this.call("start_official_provider_login");
  }

  public async cancelProviderLogin(
    loginId: string,
    _options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.call("cancel_provider_login", { loginId });
  }

  public async configureCustomProvider(
    input: ConfigureCustomProviderRequest,
    _options: MutationOptions = {},
  ): Promise<ConfigureCustomProviderResponse> {
    return this.call("configure_custom_provider", { input });
  }

  public async logoutProvider(
    _options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.call("logout_provider");
  }

  public async getGlobalSettings(options: ReadOptions & { engine?: "codex" | "claude" } = {}): Promise<AgentGlobalSettingsResponse> {
    return options.engine === "claude" ? this.invokeCommand("get_global_settings", {engine: "claude"}) : this.call("get_global_settings");
  }

  public async updateGlobalSettings(
    settings: AgentGlobalSettings,
    options: MutationOptions & { engine?: "codex" | "claude" } = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return options.engine === "claude"
      ? this.invokeCommand("update_global_settings", { settings, engine: "claude" })
      : this.call("update_global_settings", { settings });
  }

  public async getProjectDefaults(
    projectId: string,
    _options: ReadOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.call("get_project_defaults", { projectId });
  }

  public async updateProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
    _options: MutationOptions = {},
  ): Promise<AgentProjectDefaultsResponse> {
    return this.call("update_project_defaults", { projectId, settings });
  }

  public async listSkills(projectId: string, _options: ReadOptions = {}): Promise<AgentSkillPage> {
    return this.call("list_skills", { forceReload: false, projectId });
  }

  public async listMcpServers(
    projectId: string,
    taskId: string,
    _options: ReadOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.call("list_mcp_servers", { projectId, taskId });
  }

  public async retryMcpServers(
    projectId: string,
    taskId: string,
    options: MutationOptions & ReloadAgentMcpServersRequest = {},
  ): Promise<AgentMcpServerPage> {
    return this.call("retry_mcp_servers", {
      projectId,
      taskId,
      ...(options.action ? { action: options.action } : {}),
    });
  }
}
