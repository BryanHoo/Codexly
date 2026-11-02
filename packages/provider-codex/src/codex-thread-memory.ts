import type { AgentThreadMemory } from "@codexly/protocol";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { CodexProtocolMappingError, expectRecord } from "./codex-protocol-mapping.js";
import { isBackgroundTerminalThreadMissingError } from "./agent-provider-base.js";
import { RpcResponseError } from "./jsonl-rpc-errors.js";

export async function readCodexThreadMemory(
  client: CodexRpcClient,
  taskId: string,
): Promise<AgentThreadMemory> {
  try {
    // 直接读取已加载线程；绝不通过 resume 或全局 memory_summary.md 伪造会话结果。
    const response = expectRecord(
      await client.request("thread/memory/read", { threadId: taskId }),
      "thread/memory/read response",
    );
    const summary = response["summary"];
    if (summary !== null && typeof summary !== "string")
      throw new CodexProtocolMappingError("Invalid thread memory summary");
    return { status: "ready", summary };
  } catch (error) {
    if (isBackgroundTerminalThreadMissingError(error))
      return { status: "not_loaded", summary: null };
    if (error instanceof RpcResponseError && error.code === -32601)
      return { status: "unsupported", summary: null };
    throw error;
  }
}
