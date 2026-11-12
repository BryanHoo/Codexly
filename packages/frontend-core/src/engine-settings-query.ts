import type { AgentEngine, AgentEngineProfile, AgentModelPage } from "@codexly/protocol";
import {
  isApplicationPreferences,
  type ApplicationPreferences,
  type ApplicationPreferencesPatch,
} from "@codexly/protocol/application-preferences";

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

/** 配置按引擎与项目缓存，草稿和分屏共享发现结果；配置变更显式失效。 */
export function engineProfileQuery(
  load: (engine: AgentEngine) => Promise<AgentEngineProfile>,
  engine: AgentEngine,
  projectId: string,
) {
  return {
    queryKey: ["engine-profile", engine, projectId] as const,
    queryFn: () => load(engine),
    staleTime: 5 * 60_000,
  };
}

export type ApplicationSettingsRuntime = "pending" | "legacy" | "acp";
export interface ApplicationSettingsClient<T extends { readonly model: string }> {
  getGlobalSettings(options?: ReadSettingsOptions): Promise<{ settings: T }>;
  updateGlobalSettings(
    settings: T,
    options?: { engine?: AgentEngine },
  ): Promise<{ settings: T; changedFields?: readonly string[] }>;
  getApplicationPreferences?: (options?: {
    signal?: AbortSignal;
  }) => Promise<ApplicationPreferences>;
  patchApplicationPreferences?: (
    changes: ApplicationPreferencesPatch,
    options?: { idempotencyKey?: string },
  ) => Promise<ApplicationPreferences>;
}
/** 能力未确认时不读取任何旧设置；ACP 偏好缓存与旧引擎配置完全分离。 */
export function applicationSettingsQuery<T extends { readonly model: string }>(
  client: ApplicationSettingsClient<T>,
  engine: AgentEngine,
  runtime: ApplicationSettingsRuntime,
) {
  const legacy = engineSettingsQuery(client, engine);
  return {
    queryKey:
      runtime === "acp"
        ? (["application-preferences"] as const)
        : runtime === "pending"
          ? (["settings-pending"] as const)
          : legacy.queryKey,
    enabled: runtime !== "pending",
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<{ settings: T | ApplicationPreferences }> => {
      if (runtime === "pending") throw new Error("Application runtime is not ready");
      if (runtime === "legacy") return legacy.queryFn({ signal });
      if (!client.getApplicationPreferences)
        throw new Error("Application preferences are unavailable");
      return { settings: await client.getApplicationPreferences({ signal }) };
    },
  };
}
export function applicationSettingsMutation<T extends { readonly model: string }>(
  client: ApplicationSettingsClient<T>,
  engine: AgentEngine,
  runtime: ApplicationSettingsRuntime,
) {
  return {
    mutationKey: ["application-settings", "update", runtime] as const,
    meta: { actionNotification: false },
    scope: { id: "global-settings" },
    mutationFn: async (input: {
      settings: T | ApplicationPreferences;
      baseline: T | ApplicationPreferences;
      idempotencyKey?: string;
    }) => {
      if (runtime === "pending") throw new Error("Application runtime is not ready");
      if (runtime === "legacy") {
        if (!("model" in input.settings)) throw new Error("Legacy settings are required");
        return {
          runtime: "legacy" as const,
          engine,
          response: await engineSettingsMutation(client, engine).mutationFn(input.settings),
        };
      }
      if (!isApplicationPreferences(input.settings) || !isApplicationPreferences(input.baseline))
        throw new Error("Invalid application preferences draft");
      const next = input.settings,
        previous = input.baseline,
        changes: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof ApplicationPreferences)[])
        if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) changes[key] = next[key];
      if ("defaultAgent" in changes || "defaultModel" in changes) {
        changes["defaultAgent"] = next.defaultAgent;
        changes["defaultModel"] = next.defaultModel;
      }
      if (Object.keys(changes).length === 0)
        return { runtime: "acp" as const, response: { settings: next }, unchanged: true };
      if (!client.patchApplicationPreferences)
        throw new Error("Application preferences are unavailable");
      const settings = await client.patchApplicationPreferences(
        changes,
        input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey },
      );
      return { runtime: "acp" as const, response: { settings }, unchanged: false };
    },
  };
}
