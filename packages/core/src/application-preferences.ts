import {
  isApplicationPreferences,
  isApplicationPreferencesPatch,
  type ApplicationPreferences,
  type ApplicationPreferencesPatch,
} from "@codexly/protocol/application-preferences";
import type { LocalCatalogStore } from "./local-catalog.js";

const defaults: ApplicationPreferences = {
  defaultAgent: "codex",
  defaultModel: null,
  commitMessagePrompt: "",
  taskTitlePrompt: "",
  promptOptimizationPrompt: "",
  defaultOpenAppId: null,
  followUpBehavior: "queue",
  pet: { enabled: false, selectedPetId: null },
};

/** 只投影应用拥有的字段，不解析厂商配置、不把运行模型和权限复制到偏好。 */
export function applicationPreferencesFromLegacy(source: unknown): ApplicationPreferences {
  if (source === undefined || source === null) return structuredClone(defaults);
  if (typeof source !== "object" || Array.isArray(source))
    throw new TypeError("Invalid legacy application preferences");
  const result: Record<string, unknown> = structuredClone(defaults);
  for (const key of Object.keys(defaults))
    if (Object.hasOwn(source, key)) result[key] = (source as Record<string, unknown>)[key];
  if (!isApplicationPreferences(result))
    throw new TypeError("Invalid legacy application preferences");
  return result;
}

export class ApplicationPreferencesService {
  readonly #store: LocalCatalogStore;
  readonly #legacy: () => Promise<unknown>;
  constructor(store: LocalCatalogStore, legacy: () => Promise<unknown>) {
    this.#store = store;
    this.#legacy = legacy;
  }
  async read(): Promise<ApplicationPreferences> {
    return (
      (await this.#store.catalog("app.preferences.read", {})) ??
      applicationPreferencesFromLegacy(await this.#legacy())
    );
  }
  async patch(changes: ApplicationPreferencesPatch): Promise<ApplicationPreferences> {
    if (!isApplicationPreferencesPatch(changes))
      throw new TypeError("Invalid application preferences patch");
    const baseline = await this.read();
    // 写入边界会持锁重新读取；这里的旧快照只用于尚未首次保存的空记录。
    return this.#store.catalog("app.preferences.patch", { baseline, changes });
  }
}
