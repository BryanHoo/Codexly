import type { AgentModelCatalogFallback } from "@codexly/core";
import type {
  AgentModelPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@codexly/protocol";
import type { CodexProviderConnectionService } from "./provider-connection.js";
import { readActiveProvider } from "./provider-connection-config.js";

/** 配置前隔离旧身份，配置成功后再用当前原生目录补全能力。 */
export async function configureRuntimeModelCatalog(
  service: CodexProviderConnectionService,
  input: ConfigureCustomProviderRequest,
  listCliModels: () => Promise<AgentModelPage>,
  fallbackModels?: AgentModelCatalogFallback,
): Promise<ConfigureCustomProviderResponse> {
  const response = await service.configureCustom(input, async () => {
    // 写入新配置之前，只允许复用同一自定义端点的原生目录。
    try {
      const current = readActiveProvider(await service.readConfig());
      const sameEndpoint =
        current.mode === "custom" &&
        current.customBaseUrl?.trim().replace(/\/+$/u, "") ===
          input.baseUrl.trim().replace(/\/+$/u, "");
      if (sameEndpoint) {
        const models = await listCliModels();
        if (models.data.length > 0) return models;
      }
    } catch {
      /* CLI 不可用时继续第三层。 */
    }
    return typeof fallbackModels === "function" ? fallbackModels() : fallbackModels;
  });
  try {
    // 认证和配置写入成功后再创建原生目录进程，防止新端点拿到旧账号的能力。
    const models = await listCliModels();
    if (models.data.length === 0) return response;
    const names = new Map(input.models?.map((model) => [model.id.trim(), model.name.trim()]));
    const ids = new Set(models.data.map((model) => model.id));
    return {
      ...response,
      models: {
        ...models,
        data: [
          ...models.data.map((model) => ({
            ...model,
            displayName: names.get(model.id) ?? model.displayName,
          })),
          ...response.models.data.filter((model) => names.has(model.id) && !ids.has(model.id)),
        ],
      },
    };
  } catch {
    // 原生刷新失败仍保留本次已成功取得的兼容目录或同端点快照。
    return response;
  }
}
