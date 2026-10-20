import { EngineHttpClient } from "./http-client-engines.js";
import { PluginReconcileResultSchema, type PluginReconcileResult } from "@codexly/protocol";
import {
  AgentMutationErrorSchema,
  ConfiguredMcpServerPageSchema,
  InstalledSkillPageSchema,
  OpenSkillDirectoryResponseSchema,
  OfficialPluginDetailSchema,
  OfficialPluginInstallResponseSchema,
  OfficialPluginPageSchema,
  OfficialPluginUninstallResponseSchema,
  SetMcpServerEnabledResponseSchema,
  SetSkillEnabledResponseSchema,
  type ConfiguredMcpServerPage,
  type InstalledSkillPage,
  type OpenSkillDirectoryResponse,
  type OfficialPluginDetail,
  type OfficialPluginInstallResponse,
  type OfficialPluginPage,
  type OfficialPluginUninstallResponse,
  type SetMcpServerEnabledResponse,
  type SetSkillEnabledResponse,
} from "@codexly/protocol";

import { appendQuery, type MutationOptions, type ReadOptions } from "./http-client-transport.js";

export class SkillMarketHttpClient extends EngineHttpClient {
  public async reconcileOfficialPlugins(
    options: MutationOptions = {},
  ): Promise<PluginReconcileResult> {
    return this.mutation(
      "/v1/plugins/official/reconcile",
      {},
      PluginReconcileResultSchema,
      options,
    );
  }

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
  ): Promise<OfficialPluginInstallResponse> {
    return this.mutation(
      `/v1/plugins/official/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/install`,
      { installAttemptId, marketplacePath },
      OfficialPluginInstallResponseSchema,
      options,
    );
  }

  public async uninstallOfficialPlugin(
    marketplaceName: string,
    pluginName: string,
    pluginId: string,
    options: MutationOptions = {},
  ): Promise<OfficialPluginUninstallResponse> {
    return this.mutation(
      `/v1/plugins/official/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/uninstall`,
      { pluginId },
      OfficialPluginUninstallResponseSchema,
      options,
    );
  }

  public async listInstalledSkills(options: ReadOptions = {}): Promise<InstalledSkillPage> {
    return this.read("/v1/skills/installed", InstalledSkillPageSchema, options);
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
    options: ReadOptions & { projectId?: string } = {},
  ): Promise<ConfiguredMcpServerPage> {
    return this.read(
      appendQuery("/v1/mcp-servers/configured", { projectId: options.projectId }),
      ConfiguredMcpServerPageSchema,
      options,
    );
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
