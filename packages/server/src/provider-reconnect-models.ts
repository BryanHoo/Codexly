import {
  normalizeCustomModelReasoning,
  type AgentProviderConnectionRepository,
} from "@codexly/core";
import type {
  AgentModelPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@codexly/protocol";

type ReconnectModelRepository = Pick<AgentProviderConnectionRepository, "readProviderConnection">;

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
  repository: ReconnectModelRepository,
): Promise<ConfigureCustomProviderResponse["models"] | undefined> {
  if (input.models !== undefined && input.models.length > 0) return undefined;

  const activeConnection = await repository.readProviderConnection().catch(() => undefined);
  if (
    activeConnection?.mode === "custom" &&
    hasSameBaseUrl(activeConnection.customBaseUrl, input.baseUrl) &&
    activeConnection.customModels !== null &&
    activeConnection.customModels.data.length > 0
  ) {
    // Runtime 已依次尝试 API 与 CLI，这里只提供最后一层同端点缓存。
    return normalizeCustomModelReasoning(
      createSerializableModelPage(activeConnection.customModels),
    );
  }

  return undefined;
}
