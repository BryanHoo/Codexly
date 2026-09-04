import {
  AgentMutationErrorSchema,
  ClawhubSkillDetailSchema,
  ClawhubSkillPageSchema,
  ConfiguredMcpServerPageSchema,
  InstalledSkillPageSchema,
  OpenSkillDirectoryResponseSchema,
  SetMcpServerEnabledResponseSchema,
  SetSkillEnabledResponseSchema,
  SkillInstallResultSchema,
  type ClawhubSkillDetail,
  type ClawhubSkillPage,
  type ConfiguredMcpServerPage,
  type InstalledSkillPage,
  type OpenSkillDirectoryResponse,
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
