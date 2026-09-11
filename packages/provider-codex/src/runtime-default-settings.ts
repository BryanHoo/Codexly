import type { AgentRuntimeDefaultSettings } from "@codexly/core";
import type { CodexRpcClient } from "./agent-provider-base.js";

const fields = {
  approvalPolicy: "approval_policy",
  approvalsReviewer: "approvals_reviewer",
  model: "model",
  reasoningEffort: "model_reasoning_effort",
  sandboxMode: "sandbox_mode",
  fastMode: "service_tier",
} as const;

export async function writeRuntimeDefaultSettings(
  client: CodexRpcClient,
  settings: AgentRuntimeDefaultSettings,
): Promise<void> {
  const edits = (Object.keys(fields) as (keyof typeof fields)[])
    .filter((key) => settings[key] !== undefined)
    .map((key) => ({
      keyPath: fields[key],
      // default 显式关闭快速档位；不删除键，避免重新继承模型的默认档位。
      value: key === "fastMode" ? (settings.fastMode ? "priority" : "default") : settings[key],
      mergeStrategy: "replace",
    }));
  if (edits.length === 0) return;
  // 不传 cwd 或 filePath，由 Codex 定位用户全局配置并完成校验、原子写入与重载。
  await client.request("config/batchWrite", { edits, reloadUserConfig: true });
}
