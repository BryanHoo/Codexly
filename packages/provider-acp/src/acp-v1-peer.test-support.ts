import type { AgentRequestContext, PromptRequest } from "@agentclientprotocol/sdk/unstable";
export type Reason = "end_turn" | "cancelled" | "refusal" | "max_turn_requests" | "max_tokens";
/** v1 的 prompt 响应就是完整回合终态。 */
export function testPrompt(
  run: (
    context: AgentRequestContext<PromptRequest>,
  ) => { stopReason: Reason } | Promise<{ stopReason: Reason }>,
) {
  return run;
}
