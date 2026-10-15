import type { AgentTurnOptions } from "@codexly/protocol";
import { mapSandboxPolicy } from "./codex-protocol-mapping.js";

export function mapCodexTurnSettings(options: AgentTurnOptions) {
  // 普通 Turn 与 Goal 自动 Turn 使用相同设置；未知能力传 null，显式 none 原样保留。
  return {
    approvalPolicy: options.approvalPolicy,
    approvalsReviewer: options.approvalsReviewer,
    collaborationMode: {
      mode: options.collaborationMode === "plan" ? ("plan" as const) : ("default" as const),
      settings: {
        developer_instructions: null,
        model: options.model,
        reasoning_effort: options.reasoningEffort || null,
      },
    },
    effort: options.reasoningEffort || null,
    model: options.model,
    sandboxPolicy: mapSandboxPolicy(options.sandboxMode),
    // Codex 会把 Service Tier 粘附到 Thread，关闭时必须显式清除。
    serviceTier: options.fastMode === true ? "fast" : null,
  };
}
