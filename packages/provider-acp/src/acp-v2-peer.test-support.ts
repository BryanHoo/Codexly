import { randomUUID } from "node:crypto";
import {
  methods,
  type AgentRequestContext,
  type PromptRequest,
  type UpdateSessionNotification,
} from "@agentclientprotocol/sdk/experimental/v2/unstable";

export type Reason = "end_turn" | "cancelled" | "refusal" | "max_turn_requests" | "max_tokens";

/** 测试回合经 ACP v2 通知发布终态，并返回带消息标识的写入回执。 */
export function testPrompt(
  run: (
    context: AgentRequestContext<PromptRequest>,
  ) => { stopReason: Reason } | Promise<{ stopReason: Reason }>,
) {
  return async (context: AgentRequestContext<PromptRequest>) => {
    const { params, client } = context;
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "state_update", state: "running" },
    });
    const { stopReason } = await run(context);
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "state_update",
        state: "idle",
        stopReason,
      } as UpdateSessionNotification["update"],
    });
    return { messageId: randomUUID() };
  };
}
