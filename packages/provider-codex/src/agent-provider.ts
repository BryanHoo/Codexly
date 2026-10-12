export { CodexAgentProvider } from "./agent-provider-runtime.js";
import { CodexRuntimeProvider } from "./runtime-provider.js";
import type { CreateCodexRuntimeProviderOptions } from "./agent-provider-base.js";
export { CodexRuntimeProvider };

export function createCodexRuntimeProvider(
  options: CreateCodexRuntimeProviderOptions,
): CodexRuntimeProvider {
  const { client, logger, ...runtimeOptions } = options;
  return new CodexRuntimeProvider(client, logger, runtimeOptions);
}
export {
  type CodexRpcClient,
  type CreateCodexRuntimeProviderOptions,
} from "./agent-provider-base.js";
export type { CodexProviderLogger } from "./agent-provider-logger.js";
export { CodexProtocolMappingError } from "./codex-protocol-mapping.js";
