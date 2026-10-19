import type { AgentGlobalSettings, AgentProviderConnectionStatus } from "@codexly/protocol";
import type { AgentRuntimeProvider } from "./agent-provider.js";

type Preferences = Pick<AgentGlobalSettings, "defaultAgent" | "defaultModel">;
const configured = (status: AgentProviderConnectionStatus | undefined) =>
  status?.state === "connected" || status?.mode === "custom";

/** 公共生成选择只读取连接状态；不依赖当前聊天，也不为判断默认值加载模型目录。 */
export async function readGenerationDefaults(
  runtime: Pick<
    AgentRuntimeProvider,
    "readProviderConnection" | "engines" | "readGenerationDefaults"
  >,
  stored: Preferences | undefined,
): Promise<Required<Preferences>> {
  if (runtime.readGenerationDefaults) return runtime.readGenerationDefaults(stored);
  let defaultAgent = stored?.defaultAgent;
  if (defaultAgent !== "claude") {
    const codex = await runtime.readProviderConnection().catch(() => undefined);
    defaultAgent = "codex";
    if (!configured(codex) && runtime.engines?.claude) {
      // 没有 Codex 配置时直接使用 Claude，不能为选默认值启动另一个 SDK 探测进程。
      defaultAgent = "claude";
    }
  }
  return {
    defaultAgent,
    defaultModel:
      stored?.defaultModel && (stored.defaultAgent ?? "codex") === defaultAgent
        ? stored.defaultModel
        : defaultAgent === "codex"
          ? "gpt-6-luna"
          : "haiku",
  };
}
