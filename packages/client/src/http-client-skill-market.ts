import {
  AgentMutationErrorSchema,
  ClawhubSkillDetailSchema,
  ClawhubSkillPageSchema,
  ConfiguredMcpServerPageSchema,
  InstalledSkillPageSchema,
  OpenSkillDirectoryResponseSchema,
  OfficialPluginDetailSchema,
  OfficialPluginInstallResultSchema,
  OfficialPluginPageSchema,
  OfficialPluginUninstallResultSchema,
  SetMcpServerEnabledResponseSchema,
  SetSkillEnabledResponseSchema,
  SkillInstallResultSchema,
  type ClawhubSkillDetail,
  type ClawhubSkillPage,
  type ConfiguredMcpServerPage,
  type InstalledSkillPage,
  type OpenSkillDirectoryResponse,
  type OfficialPluginDetail,
  type OfficialPluginInstallResult,
  type OfficialPluginPage,
  type OfficialPluginUninstallResult,
  type SetMcpServerEnabledResponse,
  type SetSkillEnabledResponse,
  type SkillInstallResult,
  type SkillInstallScope,
} from "@codexly/protocol";

import {
  CodexlyTransport,
  appendQuery,
  type MutationOptions,
  type ReadOptions,
} from "./http-client-transport.js";

export class SkillMarketHttpClient extends CodexlyTransport {
  public async listOfficialPlugins(
    forceRefetch: boolean,
    options: ReadOptions = {},
  ): Promise<OfficialPluginPage> {
    return this.read(
      appendQuery("/v1/plugins/official", { forceRefetch: forceRefetch ? "true" : undefined }),
      OfficialPluginPageSchema,
      options,
    );
  }

  public async getOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
    options: ReadOptions = {},
  ): Promise<OfficialPluginDetail> {
    return this.read(
      appendQuery(
        `/v1/plugins/official/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}`,
        { marketplacePath: marketplacePath ?? undefined },
      ),
      OfficialPluginDetailSchema,
      options,
      AgentMutationErrorSchema,
    );
  }

  public async installOfficialPlugin(
    marketplaceName: string,
    marketplacePath: string | null,
    pluginName: string,
    installAttemptId: string,
    options: MutationOptions = {},
  ): Promise<OfficialPluginInstallResult> {
    return this.mutation(
      `/v1/plugins/official/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/install`,
      { installAttemptId, marketplacePath },
      OfficialPluginInstallResultSchema,
      options,
    );
  }

  public async uninstallOfficialPlugin(
    marketplaceName: string,
    pluginName: string,
    pluginId: string,
    options: MutationOptions = {},
  ): Promise<OfficialPluginUninstallResult> {
    return this.mutation(
      `/v1/plugins/official/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/uninstall`,
      { pluginId },
      OfficialPluginUninstallResultSchema,
      options,
    );
  }

  public async listInstalledSkills(options: ReadOptions = {}): Promise<InstalledSkillPage> {
    return this.read("/v1/skills/installed", InstalledSkillPageSchema, options);
  }

  public async listClawhubSkills(
    query: string,
    cursor: string | null,
    sort: string,
    options: ReadOptions = {},
  ): Promise<ClawhubSkillPage> {
    return this.read(
      appendQuery("/v1/skills/market", {
        cursor: cursor ?? undefined,
        query: query.length === 0 ? undefined : query,
        sort,
      }),
      ClawhubSkillPageSchema,
      options,
      AgentMutationErrorSchema,
    );
  }

  public async getClawhubSkill(
    owner: string,
    slug: string,
    options: ReadOptions = {},
  ): Promise<ClawhubSkillDetail> {
    return this.read(
      `/v1/skills/market/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
      ClawhubSkillDetailSchema,
      options,
      AgentMutationErrorSchema,
    );
  }

  public async installClawhubSkill(
    owner: string,
    slug: string,
    scope: SkillInstallScope,
    projectId?: string,
    rootPath?: string,
    options: MutationOptions = {},
  ): Promise<SkillInstallResult> {
    return this.mutation(
      `/v1/skills/market/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/install`,
      { projectId, rootPath, scope },
      SkillInstallResultSchema,
      options,
    );
  }

  public async openSkillDirectory(
    path: string,
    options: MutationOptions = {},
  ): Promise<OpenSkillDirectoryResponse> {
    return this.mutation("/v1/skills/open", { path }, OpenSkillDirectoryResponseSchema, options);
  }

  public async setSkillEnabled(
    path: string,
    enabled: boolean,
    options: MutationOptions = {},
  ): Promise<SetSkillEnabledResponse> {
    return this.mutation(
      "/v1/skills/enabled",
      { enabled, path },
      SetSkillEnabledResponseSchema,
      options,
      "PUT",
    );
  }

  public async listConfiguredMcpServers(
    options: ReadOptions = {},
  ): Promise<ConfiguredMcpServerPage> {
    return this.read("/v1/mcp-servers/configured", ConfiguredMcpServerPageSchema, options);
  }

  public async setMcpServerEnabled(
    name: string,
    enabled: boolean,
    options: MutationOptions = {},
  ): Promise<SetMcpServerEnabledResponse> {
    return this.mutation(
      `/v1/mcp-servers/configured/${encodeURIComponent(name)}/enabled`,
      { enabled },
      SetMcpServerEnabledResponseSchema,
      options,
      "PUT",
    );
  }
}
