import type { AgentPreferences, MemorySettings, MemorySettingsUpdate } from "@codexly/protocol";
import type { CodexRpcClient } from "./agent-provider-base.js";
import { expectRecord } from "./codex-protocol-mapping.js";

async function readConfig(client: CodexRpcClient) {
  const response = expectRecord(
    await client.request("config/read", { includeLayers: false }),
    "config/read response",
  );
  return expectRecord(response["config"], "config/read config");
}
function section(config: Record<string, unknown>, key: string) {
  return config[key] === undefined ? {} : expectRecord(config[key], key);
}
const edit = (keyPath: string, value: unknown) => ({ keyPath, value, mergeStrategy: "replace" });

export async function readMemorySettings(client: CodexRpcClient): Promise<MemorySettings> {
  const config = await readConfig(client);
  const features = section(config, "features");
  const memories = section(config, "memories");
  return {
    enabled:
      features["memories"] === true &&
      memories["generate_memories"] !== false &&
      memories["use_memories"] !== false,
    allowExternalContext: !(
      memories["disable_on_external_context"] ??
      memories["no_memories_if_mcp_or_web_search"] ??
      false
    ),
  };
}
export async function updateMemorySettings(client: CodexRpcClient, update: MemorySettingsUpdate) {
  const edits = [];
  // 同批更新生成和使用开关，防止关闭后仍继续注入记忆。
  if (update.enabled !== undefined)
    for (const key of ["features.memories", "memories.generate_memories", "memories.use_memories"])
      edits.push(edit(key, update.enabled));
  if (update.allowExternalContext !== undefined) {
    edits.push(edit("memories.no_memories_if_mcp_or_web_search", null));
    edits.push(edit("memories.disable_on_external_context", !update.allowExternalContext));
  }
  if (edits.length) await client.request("config/batchWrite", { edits, reloadUserConfig: true });
  return readMemorySettings(client);
}
export async function resetMemories(client: CodexRpcClient): Promise<void> {
  // 官方接口同时清理文件与处理数据库，保留聊天历史。
  await client.request("memory/reset", null);
}
export async function readAgentPreferences(client: CodexRpcClient): Promise<AgentPreferences> {
  const config = await readConfig(client);
  const verbosity = config["model_verbosity"];
  const search = config["web_search"];
  return {
    webSearch: search === "disabled" || search === "live" ? search : "cached",
    modelVerbosity:
      verbosity === "low" || verbosity === "medium" || verbosity === "high" ? verbosity : null,
  };
}
export async function updateAgentPreferences(client: CodexRpcClient, settings: AgentPreferences) {
  await client.request("config/batchWrite", {
    edits: [
      edit("web_search", settings.webSearch),
      edit("model_verbosity", settings.modelVerbosity),
    ],
    reloadUserConfig: true,
  });
  return readAgentPreferences(client);
}
