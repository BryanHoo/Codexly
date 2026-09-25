import type { MutationOptions, ReadOptions } from "@/platform/native-client-types.js";
import type {
  AgentGlobalSettings,
  AgentGlobalSettingsResponse,
  AgentMcpServerPage,
  AgentModelPage,
  AgentProjectDefaults,
  AgentProjectDefaultsResponse,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentSkillPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  StartOfficialProviderLoginResponse,
  ClawhubSkillDetail,
  ClawhubSkillPage,
  ConfiguredMcpServerPage,
  InstalledSkillPage,
  OfficialPluginDetail,
  OfficialPluginInstallResult,
  OfficialPluginPage,
  SkillInstallResult,
  SkillInstallScope,
} from "@/protocol/index.js";

import { TauriWorkspaceClient } from "./workspace-client.js";
import type { GlobalInstructions, MemorySettings, MemorySettingsUpdate } from "@/protocol/index.js";

export class TauriCatalogClient extends TauriWorkspaceClient {
  public async getGlobalInstructions(): Promise<GlobalInstructions> {
    const { parseInstructions } = await import("./personalization-response.js");
    return parseInstructions(await this.call("get_global_instructions"));
  }

  public async saveGlobalInstructions(content: string, expectedContent: string): Promise<GlobalInstructions> {
    const { parseInstructions } = await import("./personalization-response.js");
    return parseInstructions(await this.call("save_global_instructions", { content, expectedContent }));
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

  public async getGlobalSettings(
    _options: ReadOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.call("get_global_settings");
  }

  public async updateGlobalSettings(
    settings: AgentGlobalSettings,
    _options: MutationOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.call("update_global_settings", { settings });
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

  public async listSkills(
    projectId: string,
    _options: ReadOptions = {},
  ): Promise<AgentSkillPage> {
    return this.call("list_skills", { forceReload: false, projectId });
  }

  public async listInstalledSkills(
    _options: ReadOptions = {},
  ): Promise<InstalledSkillPage> {
    return this.call("list_installed_skills", { forceReload: false });
  }

  public async listConfiguredMcpServers(
    _options: ReadOptions = {},
  ): Promise<ConfiguredMcpServerPage> {
    return this.call("list_configured_mcp_servers");
  }

  public async openSkillDirectory(
    path: string,
    _options: MutationOptions = {},
  ): Promise<Readonly<{ status: string }>> {
    return this.call("open_skill_directory", { path });
  }

  public async setSkillEnabled(
    path: string,
    enabled: boolean,
    _options: MutationOptions = {},
  ): Promise<Readonly<{ effectiveEnabled: boolean }>> {
    return this.call("set_skill_enabled", { enabled, path });
  }

  public async setMcpServerEnabled(
    name: string,
    enabled: boolean,
    _options: MutationOptions = {},
  ): Promise<Readonly<{ enabled: boolean }>> {
    return this.call("set_mcp_server_enabled", { enabled, name });
  }

  public async listClawhubSkills(
    query: string,
    cursor: string | null,
    sort: string,
    _options: ReadOptions = {},
  ): Promise<ClawhubSkillPage> {
    return this.call("list_clawhub_skills", { cursor, query, sort });
  }

  public async getClawhubSkill(
    owner: string,
    slug: string,
    _options: ReadOptions = {},
  ): Promise<ClawhubSkillDetail> {
    return this.call("get_clawhub_skill", { owner, slug });
  }

  public async installClawhubSkill(
    owner: string,
    slug: string,
    scope: SkillInstallScope,
    projectId?: string,
    rootPath?: string,
    _options: MutationOptions = {},
  ): Promise<SkillInstallResult> {
    return this.call("install_clawhub_skill", { owner, projectId, rootPath, scope, slug });
  }

  public async listOfficialPlugins(
    forceRefetch: boolean,
    _options: ReadOptions = {},
  ): Promise<OfficialPluginPage> {
    return this.call("list_official_plugins", { forceRefetch });
  }

  public async getOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
    _options: ReadOptions = {},
  ): Promise<OfficialPluginDetail> {
    return this.call("get_official_plugin", { marketplaceName, marketplacePath, pluginName });
  }

  public async installOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
    installAttemptId: string,
    _options: MutationOptions = {},
  ): Promise<OfficialPluginInstallResult> {
    return this.call("install_official_plugin", {
      installAttemptId,
      marketplaceName,
      marketplacePath,
      pluginName,
    });
  }

  public async uninstallOfficialPlugin(
    pluginId: string,
    _options: MutationOptions = {},
  ): Promise<Readonly<Record<string, never>>> {
    return this.call("uninstall_official_plugin", { pluginId });
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
    _options: MutationOptions = {},
  ): Promise<AgentMcpServerPage> {
    return this.call("retry_mcp_servers", { projectId, taskId });
  }
}
