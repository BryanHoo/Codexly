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

  const [activeConnection, persistedConnection] = await Promise.all([
    provider.readProviderConnection(),
    repository.readProviderConnection(),
  ]);
  if (
    activeConnection.mode === "custom" &&
    hasSameBaseUrl(activeConnection.customBaseUrl, input.baseUrl)
  ) {
    try {
      // 上游 /models 由 configureCustomProvider 优先请求；这里准备第二层 CLI 回退目录。
      return createSerializableModelPage(await provider.listModels());
    } catch {
      // CLI 目录不可用时继续读取最后一层持久化快照。
    }
  }

  if (
    persistedConnection?.mode === "custom" &&
    persistedConnection.customModels !== null &&
    hasSameBaseUrl(persistedConnection.customBaseUrl, input.baseUrl)
  ) {
    return persistedConnection.customModels;
  }
  return undefined;
}
