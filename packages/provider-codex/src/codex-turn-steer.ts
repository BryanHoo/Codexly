import { AgentTurnNotSubmittedError } from "@codexly/core";
import { CodexProtocolMappingError, expectRecord } from "./codex-protocol-mapping.js";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { RpcResponseError } from "./jsonl-rpc-errors.js";

/** 在 RPC 边界区分明确未提交与结果未知；重试决策由共享队列持有。 */
export async function steerCodexTurn(
  client: CodexRpcClient,
  taskId: string,
  turnId: string,
  input: readonly unknown[],
): Promise<void> {
  let result: unknown;
  try {
    result = await client.request("turn/steer", {
      expectedTurnId: turnId,
      input,
      threadId: taskId,
    });
  } catch (error) {
    // Codex 的 NotSubmitted 分支保证未投递；只接受完整错误与本次 expectedTurnId，
    // 不能把相似文本、其他 RPC 错误码或传输故障当作安全重试依据。
    if (error instanceof RpcResponseError && error.code === -32600) {
      const mismatch = /^expected active turn id `([^`]+)` but found `([^`]+)`$/.exec(
        error.message,
      );
      if (
        error.message === "no active turn to steer" ||
        (mismatch?.[0] === error.message && mismatch[1] === turnId)
      ) {
        throw new AgentTurnNotSubmittedError(error.message, { cause: error });
      }
    }
    throw error;
  }
  const response = expectRecord(result, "turn/steer response");
  if (response["turnId"] !== turnId) {
    throw new CodexProtocolMappingError("turn/steer returned an unexpected turn id");
  }
}
