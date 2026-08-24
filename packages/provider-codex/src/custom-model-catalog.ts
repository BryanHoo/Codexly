import type {
  AgentModel,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@code-agent/protocol";

const DEFAULT_REASONING_EFFORTS: AgentModel["supportedReasoningEfforts"] = [
  { description: "", id: "medium" },
];

export type CustomModelDefinition = Readonly<{
  defaultReasoningEffort?: string;
  id: string;
  name: string;
  supportedReasoningEfforts?: AgentModel["supportedReasoningEfforts"];
}>;

export class CodexProviderConnectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodexProviderConnectionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReasoningMetadata(
  value: Record<string, unknown>,
): Pick<CustomModelDefinition, "defaultReasoningEffort" | "supportedReasoningEfforts"> {
  const rawEfforts = value["supported_reasoning_levels"];
  if (!Array.isArray(rawEfforts)) return {};

  const efforts = new Map<string, AgentModel["supportedReasoningEfforts"][number]>();
  for (const rawEffort of rawEfforts) {
    if (!isRecord(rawEffort) || typeof rawEffort["effort"] !== "string") continue;
    const id = rawEffort["effort"].trim();
    if (id.length === 0 || id.length > 256 || efforts.has(id)) continue;
    const description =
      typeof rawEffort["description"] === "string" ? rawEffort["description"].slice(0, 1_000) : "";
    efforts.set(id, { description, id });
  }
  if (efforts.size === 0) return {};

  // Codex 的 ReasoningEffort 支持未来 Provider 自定义字符串，必须保留目录顺序与原值。
  const supportedReasoningEfforts = [...efforts.values()];
  const advertisedDefault =
    typeof value["default_reasoning_level"] === "string"
      ? value["default_reasoning_level"].trim()
      : "";
  const firstReasoningEffort = supportedReasoningEfforts[0];
  if (firstReasoningEffort === undefined) return {};
  const defaultReasoningEffort = efforts.has(advertisedDefault)
    ? advertisedDefault
    : (supportedReasoningEfforts.find((effort) => effort.id === "medium")?.id ??
      firstReasoningEffort.id);
  return { defaultReasoningEffort, supportedReasoningEfforts };
}

function readCatalogArray(value: unknown): {
  idField: "id" | "slug";
  models: unknown[];
  nameField: "display_name" | "name";
} {
  if (!isRecord(value)) {
    throw new CodexProviderConnectionError("Custom model endpoint returned an invalid response");
  }
  if (Array.isArray(value["models"])) {
    return { idField: "slug", models: value["models"], nameField: "display_name" };
  }
  if (Array.isArray(value["data"])) {
    return { idField: "id", models: value["data"], nameField: "name" };
  }
  throw new CodexProviderConnectionError("Custom model endpoint returned an invalid response");
}

export function readDiscoveredModels(value: unknown, countLimit: number): CustomModelDefinition[] {
  const { idField, models: rawModels, nameField } = readCatalogArray(value);
  if (rawModels.length > countLimit) {
    throw new CodexProviderConnectionError("Custom model endpoint returned too many models");
  }

  const models: CustomModelDefinition[] = [];
  for (const item of rawModels) {
    if (!isRecord(item) || typeof item[idField] !== "string") continue;
    const id = item[idField].trim();
    if (id.length === 0 || id.length > 256) continue;
    const candidateName = typeof item[nameField] === "string" ? item[nameField].trim() : "";
    models.push({
      id,
      name: candidateName.length > 0 && candidateName.length <= 256 ? candidateName : id,
      ...readReasoningMetadata(item),
    });
  }
  return models;
}

export function normalizeManualModels(
  values: readonly NonNullable<ConfigureCustomProviderRequest["models"]>[number][],
  countLimit: number,
): CustomModelDefinition[] {
  const models = new Map<string, CustomModelDefinition>();
  for (const value of values) {
    const id = value.id.trim();
    const name = value.name.trim();
    if (id.length === 0 || name.length === 0 || id.length > 256 || name.length > 256) {
      throw new CodexProviderConnectionError("Custom model id or name is invalid");
    }
    models.set(id, { id, name });
  }
  if (models.size > countLimit) {
    throw new CodexProviderConnectionError("Custom provider returned too many models");
  }
  return [...models.values()];
}

export function mapCustomModels(
  values: readonly CustomModelDefinition[],
  countLimit: number,
): ConfigureCustomProviderResponse["models"] {
  const modelsById = new Map<string, CustomModelDefinition>();
  for (const model of values) {
    const current = modelsById.get(model.id);
    const defaultReasoningEffort = model.defaultReasoningEffort ?? current?.defaultReasoningEffort;
    const supportedReasoningEfforts =
      model.supportedReasoningEfforts ?? current?.supportedReasoningEfforts;
    // 手动名称可覆盖远端展示名，但不能抹掉远端声明的模型能力。
    modelsById.set(model.id, {
      ...current,
      ...model,
      ...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
      ...(supportedReasoningEfforts === undefined ? {} : { supportedReasoningEfforts }),
    });
  }
  const orderedModels = [...modelsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  if (orderedModels.length > countLimit) {
    throw new CodexProviderConnectionError("Custom provider returned too many models");
  }
  if (orderedModels.length === 0) {
    throw new CodexProviderConnectionError("Custom provider returned no usable models");
  }

  const data: AgentModel[] = orderedModels.map((model, index) => {
    const supportedReasoningEfforts =
      model.supportedReasoningEfforts === undefined || model.supportedReasoningEfforts.length === 0
        ? DEFAULT_REASONING_EFFORTS
        : model.supportedReasoningEfforts;
    const defaultReasoningEffort = supportedReasoningEfforts.some(
      (effort) => effort.id === model.defaultReasoningEffort,
    )
      ? model.defaultReasoningEffort
      : supportedReasoningEfforts[0]?.id;
    if (defaultReasoningEffort === undefined) {
      throw new CodexProviderConnectionError("Custom model has no reasoning effort");
    }
    return {
      defaultReasoningEffort,
      description: "",
      displayName: model.name,
      id: model.id,
      isDefault: index === 0,
      supportedReasoningEfforts,
    };
  });
  return { data, nextCursor: null };
}
