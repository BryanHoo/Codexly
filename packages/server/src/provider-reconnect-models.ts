import { normalizeCustomModelReasoning, type AgentRuntimeProvider } from "@codexly/core";
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
): Promise<ConfigureCustomProviderResponse["models"] | undefined> {
  if (input.models !== undefined) return undefined;

  const activeConnection = await provider.readProviderConnection();
  if (
    activeConnection.mode === "custom" &&
    hasSameBaseUrl(activeConnection.customBaseUrl, input.baseUrl)
  ) {
    try {
      // 上游 /models 由 configureCustomProvider 优先请求；这里准备第二层 CLI 回退目录。
      return normalizeCustomModelReasoning(
        createSerializableModelPage(await provider.listModels()),
      );
    } catch {
      // 允许随后重新连接和在线发现，但不能把失败前的持久化目录重新注入缓存。
      return { data: [], nextCursor: null };
    }
  }

  return undefined;
}
