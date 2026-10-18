import type { AgentEngine, AgentModelPage } from "@codexly/protocol";

interface ReadSettingsOptions {
  signal?: AbortSignal;
  engine?: AgentEngine;
}
interface SettingsReadClient<TResponse> {
  getGlobalSettings(options?: ReadSettingsOptions): Promise<TResponse>;
}
interface SettingsMutationClient<TSettings, TResponse> {
  updateGlobalSettings(settings: TSettings, options?: { engine?: AgentEngine }): Promise<TResponse>;
}
interface ModelsClient {
  listModels(options?: { signal?: AbortSignal }): Promise<AgentModelPage>;
  getEngineProfile?: (engine: "claude") => Promise<{ models: AgentModelPage }>;
}

/** 两端共用引擎范围及缓存身份，启用另一个引擎后不能复用前一个引擎的模型与设置。 */
export function engineModelsQuery(client: ModelsClient, engine: AgentEngine) {
  return {
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      if (engine === "codex") return client.listModels({ signal });
      const profile = await client.getEngineProfile?.("claude");
      if (!profile) throw new Error("Claude engine is unavailable");
      return profile.models;
    },
    queryKey: engine === "claude" ? (["models", "claude"] as const) : (["models"] as const),
    staleTime: 5 * 60_000,
  };
}
export function engineSettingsQuery<TResponse>(
  client: SettingsReadClient<TResponse>,
  engine: AgentEngine,
) {
  return {
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      client.getGlobalSettings({ signal, ...(engine === "claude" ? { engine } : {}) }),
    queryKey: engine === "claude" ? (["settings", "claude"] as const) : (["settings"] as const),
  };
}
export function engineSettingsMutation<TSettings, TResponse>(
  client: SettingsMutationClient<TSettings, TResponse>,
  engine: AgentEngine,
) {
  return {
    mutationFn: (settings: TSettings) =>
      engine === "claude"
        ? client.updateGlobalSettings(settings, { engine })
        : client.updateGlobalSettings(settings),
    mutationKey: ["settings", "update"] as const,
    meta: { actionNotification: false },
    scope: { id: "global-settings" },
  };
}
