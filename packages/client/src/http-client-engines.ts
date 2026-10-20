import {
  AgentEngineProfileSchema,
  ClaudeSettingsSchema,
  ConfigureCustomProviderResponseSchema,
  AgentProviderConnectionMutationResponseSchema,
  AgentMutationErrorSchema,
  ClaudeExtensionPageSchema,
  type ClaudeExtensionPage,
  type ClaudeExtensionKind,
  type ClaudeExtensionMutation,
  type ClaudeSettings,
  type AgentEngine,
  type AgentEngineProfile,
  type ConfigureCustomProviderRequest,
  type ConfigureCustomProviderResponse,
  type AgentProviderConnectionMutationResponse,
} from "@codexly/protocol";
import { CodexlyTransport } from "./http-client-transport.js";
import type { ReadOptions, MutationOptions } from "./http-client-transport.js";

export class EngineHttpClient extends CodexlyTransport {
  public listClaudeExtensions(
    kind: ClaudeExtensionKind,
    projectId?: string,
  ): Promise<ClaudeExtensionPage> {
    const query = new URLSearchParams({ kind, ...(projectId ? { projectId } : {}) });
    return this.request(
      `/v1/engines/claude/extensions?${query}`,
      ClaudeExtensionPageSchema,
      {},
      AgentMutationErrorSchema,
      { timeoutMs: 45_000 },
    );
  }
  public mutateClaudeExtension(
    input: ClaudeExtensionMutation,
    projectId?: string,
  ): Promise<ClaudeExtensionPage> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return this.mutation(
      `/v1/engines/claude/extensions${query}`,
      input,
      ClaudeExtensionPageSchema,
      {},
      "POST",
      120_000,
    );
  }
  public getClaudeSettings(options: ReadOptions = {}): Promise<ClaudeSettings> {
    return this.read("/v1/engines/claude/settings", ClaudeSettingsSchema, options);
  }

  public updateClaudeSettings(
    settings: ClaudeSettings,
    options: MutationOptions = {},
  ): Promise<ClaudeSettings> {
    return this.mutation(
      "/v1/engines/claude/settings",
      settings,
      ClaudeSettingsSchema,
      options,
      "PUT",
    );
  }
  public async getEngineProfile(
    engine: AgentEngine,
    projectId?: string,
    options: ReadOptions = {},
  ): Promise<AgentEngineProfile> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return this.read(`/v1/engines/${engine}${query}`, AgentEngineProfileSchema, options);
  }

  public async configureEngine(
    engine: AgentEngine,
    input: ConfigureCustomProviderRequest,
    options: MutationOptions = {},
  ): Promise<ConfigureCustomProviderResponse> {
    return this.mutation(
      `/v1/engines/${engine}/connection`,
      input,
      ConfigureCustomProviderResponseSchema,
      options,
      "PUT",
    );
  }

  public async disconnectEngine(
    engine: AgentEngine,
    options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.mutation(
      `/v1/engines/${engine}/connection`,
      undefined,
      AgentProviderConnectionMutationResponseSchema,
      options,
      "DELETE",
    );
  }
}
