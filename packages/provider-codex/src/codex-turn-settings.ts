import type { AgentTurnOptions } from "@codexly/protocol";
import { mapSandboxPolicy } from "./codex-protocol-mapping.js";

export function mapCodexTurnSettings(options: AgentTurnOptions) {
  // 普通 Turn 与 Goal 自动 Turn 使用相同的执行设置。
  return {
    approvalPolicy: options.approvalPolicy,
    approvalsReviewer: options.approvalsReviewer,
    collaborationMode: {
      mode: options.collaborationMode === "plan" ? ("plan" as const) : ("default" as const),
      settings: {
        developer_instructions: null,
        model: options.model,
        reasoning_effort: options.reasoningEffort,
      },
    },
    effort: options.reasoningEffort,
    model: options.model,
    sandboxPolicy: mapSandboxPolicy(options.sandboxMode),
    // Codex 会把 Service Tier 粘附到 Thread，关闭时必须显式清除。
    serviceTier: options.fastMode === true ? "fast" : null,
  };
}
