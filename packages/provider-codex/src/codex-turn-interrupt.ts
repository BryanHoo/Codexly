import type { CodexRpcClient } from "./codex-rpc-client.js";
import { expectRecord } from "./codex-protocol-mapping.js";
import { RpcResponseError } from "./jsonl-rpc-errors.js";

export async function interruptCodexTurn(
  client: CodexRpcClient,
  threadId: string,
  turnId: string,
): Promise<void> {
  try {
    expectRecord(
      await client.request("turn/interrupt", { threadId, turnId }),
      "turn/interrupt response",
    );
  } catch (error) {
    // 回合可能在点击停止后、RPC 到达前结束，此时停止目标已达成。
    // 只接受上游明确的空闲响应；ID 不匹配、断连等错误继续上抛，终态仍由事件同步。
    if (
      error instanceof RpcResponseError &&
      error.code === -32600 &&
      error.message === "no active turn to interrupt"
    ) {
      return;
    }
    throw error;
  }
}
