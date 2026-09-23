const DEFAULT_CUSTOM_PROVIDER_ID = "OpenAI";

export type ProviderConfigEdit = Readonly<{
  keyPath: string;
  mergeStrategy: "replace" | "upsert";
  value: unknown;
}>;

export type CustomProviderConfigUpdate = Readonly<{
  edits: readonly ProviderConfigEdit[];
  providerId: string;
  requiresOpenaiAuth: boolean;
  rollbackEdits: readonly ProviderConfigEdit[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readConfiguredProviderId(config: Record<string, unknown>): string | null {
  return nonEmptyString(config["model_provider"]);
}

function readModelProviderConfig(
  config: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> | null {
  const providers = isRecord(config["model_providers"]) ? config["model_providers"] : null;
  const provider = providers?.[providerId];
  return isRecord(provider) ? provider : null;
}

export function hasCurrentCustomModelCatalog(config: Record<string, unknown>): boolean {
  const activeProvider = readActiveProvider(config);
  const providerId = readConfiguredProviderId(config);
  if (activeProvider.mode !== "custom" || providerId === null || providerId === "openai") {
    return false;
  }
  const provider = readModelProviderConfig(config, providerId);
  const features = isRecord(config["features"]) ? config["features"] : null;
  const configuredBaseUrl = optionalString(provider?.["base_url"], 2_048);
  const configuredCatalogUrl = optionalString(provider?.["model_catalog_url"], 2_048);
  if (configuredBaseUrl === null || configuredCatalogUrl === null) return false;
  const baseUrl = configuredBaseUrl.replace(/\/+$/u, "");
  const catalogUrl = configuredCatalogUrl.replace(/\/+$/u, "");
  return catalogUrl === `${baseUrl}/models` && features?.["api_key_model_discovery"] === true;
}

export function readActiveProvider(config: Record<string, unknown>): {
  customBaseUrl: string | null;
  mode: "custom" | "official";
} {
  const providerId = readConfiguredProviderId(config) ?? "openai";
  const openaiBaseUrl = optionalString(config["openai_base_url"], 2_048);
  if (providerId === "openai") {
    return openaiBaseUrl === null || openaiBaseUrl.length === 0
      ? { customBaseUrl: null, mode: "official" }
      : { customBaseUrl: openaiBaseUrl, mode: "custom" };
  }

  const provider = readModelProviderConfig(config, providerId);
  const baseUrl = optionalString(provider?.["base_url"], 2_048);
  // 非内置 openai Provider 由 Codex CLI 配置驱动，不限定为应用创建的 Provider。
  return {
    customBaseUrl: baseUrl === null || baseUrl.length === 0 ? null : baseUrl,
    mode: "custom",
  };
}

export function createCustomProviderConfigUpdate(
  config: Record<string, unknown>,
  baseUrl: string,
  hasApiKey: boolean,
): CustomProviderConfigUpdate {
  const configuredProviderId = readConfiguredProviderId(config);
  const existingProviderId =
    readActiveProvider(config).mode === "custom" && configuredProviderId !== "openai"
      ? configuredProviderId
      : null;
  const providerId = existingProviderId ?? DEFAULT_CUSTOM_PROVIDER_ID;
  const previousProvider = readModelProviderConfig(config, providerId);
  const previousFeatures = isRecord(config["features"]) ? config["features"] : null;
  const previousRequiresOpenaiAuth = previousProvider?.["requires_openai_auth"];
  const migratesOpenAiOverride =
    configuredProviderId === "openai" && readActiveProvider(config).mode === "custom";
  const requiresOpenaiAuth = hasApiKey
    ? true
    : migratesOpenAiOverride
      ? true
      : typeof previousRequiresOpenaiAuth === "boolean"
        ? previousRequiresOpenaiAuth
        : false;
  const configuredName = nonEmptyString(previousProvider?.["name"]);
  const edits: ProviderConfigEdit[] = [
    {
      keyPath: `model_providers.${providerId}`,
      mergeStrategy: "upsert",
      value: {
        base_url: baseUrl,
        model_catalog_url: `${baseUrl}/models`,
        name: configuredName ?? providerId,
        requires_openai_auth: requiresOpenaiAuth,
        wire_api: "responses",
      },
    },
    {
      keyPath: "features.api_key_model_discovery",
      mergeStrategy: "upsert",
      value: true,
    },
  ];
  const rollbackEdits: ProviderConfigEdit[] = [
    {
      keyPath: `model_providers.${providerId}`,
      mergeStrategy: "replace",
      value: previousProvider,
    },
    {
      keyPath: "features.api_key_model_discovery",
      mergeStrategy: "replace",
      value: previousFeatures?.["api_key_model_discovery"] ?? null,
    },
  ];
  // 已激活的自定义 Provider 属于用户配置；重连只能更新它，不能切换选择。
  if (existingProviderId === null) {
    edits.push({
      keyPath: "model_provider",
      mergeStrategy: "upsert",
      value: DEFAULT_CUSTOM_PROVIDER_ID,
    });
    rollbackEdits.push({
      keyPath: "model_provider",
      mergeStrategy: "replace",
      value: config["model_provider"] ?? null,
    });
    if (configuredProviderId === "openai" && config["openai_base_url"] !== undefined) {
      edits.push({ keyPath: "openai_base_url", mergeStrategy: "replace", value: null });
      rollbackEdits.push({
        keyPath: "openai_base_url",
        mergeStrategy: "replace",
        value: config["openai_base_url"],
      });
    }
  }
  return { edits, providerId, requiresOpenaiAuth, rollbackEdits };
}
