import type { AgentProviderConnectionRepository, AgentRuntimeProvider } from "@codexly/core";
import type {
  AgentModelPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@codexly/protocol";

type ReconnectModelProvider = Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;

function normalizeComparableBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function hasSameBaseUrl(left: string | null, right: string): boolean {
  return left !== null && normalizeComparableBaseUrl(left) === normalizeComparableBaseUrl(right);
}

function createSerializableModelPage(
  page: AgentModelPage,
): ConfigureCustomProviderResponse["models"] {
  return {
    data: page.data.map((model) => ({
      ...model,
      supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    })),
    nextCursor: page.nextCursor,
  };
}

export async function resolveReconnectModels(
  input: ConfigureCustomProviderRequest,
  provider: ReconnectModelProvider,
  repository: Pick<AgentProviderConnectionRepository, "readProviderConnection">,
): Promise<ConfigureCustomProviderResponse["models"] | undefined> {
  if (input.models !== undefined) return undefined;

  const persistedConnection = await repository.readProviderConnection();
  if (
    persistedConnection?.mode === "custom" &&
    persistedConnection.customModels !== null &&
    persistedConnection.customModels.data.length > 0 &&
    hasSameBaseUrl(persistedConnection.customBaseUrl, input.baseUrl)
  ) {
    return persistedConnection.customModels;
  }

  const activeConnection = await provider.readProviderConnection();
  if (
    activeConnection.mode !== "custom" ||
    !hasSameBaseUrl(activeConnection.customBaseUrl, input.baseUrl)
  ) {
    return undefined;
  }

  // 外部 config.toml 没有 SQLite 记录时，从已认证的 Codex Provider 恢复目录。
  return createSerializableModelPage(await provider.listModels());
}
