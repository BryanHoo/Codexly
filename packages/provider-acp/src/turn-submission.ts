import { AgentTurnNotSubmittedError } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";

/** 只在调用 ACP prompt 前声明“未提交”；一旦进入传输，断线和超时均保持结果未知。 */
export async function submitAcpTurn(
  operation: (submitted: () => void) => Promise<AgentTurn>,
): Promise<AgentTurn> {
  const state = { submitted: false };
  try {
    return await operation(() => {
      state.submitted = true;
    });
  } catch (error) {
    if (state.submitted || error instanceof AgentTurnNotSubmittedError) throw error;
    throw new AgentTurnNotSubmittedError(
      error instanceof Error ? error.message : "ACP 输入未提交",
      { cause: error },
    );
  }
}
