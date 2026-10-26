import { isAbsolute } from "node:path";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

export async function saveCodexDiagnostics(
  client: Pick<CodexRpcClient, "request">,
  savePath: string,
): Promise<void> {
  if (!isAbsolute(savePath) || !savePath.endsWith(".zip")) {
    throw new CodexProtocolMappingError("feedback/save requires an absolute ZIP path");
  }
  try {
    // 路径由宿主创建的私有临时目录限定；只保存本地，不走反馈上传接口。
    const response = expectRecord(
      await client.request(
        "feedback/save",
        {
          savePath,
          classification: "bug",
          includeLogs: true,
        },
        120_000,
      ),
      "feedback/save response",
    );
    if (expectString(response["savedPath"], "feedback/save saved path") !== savePath) {
      throw new CodexProtocolMappingError("feedback/save returned a different path");
    }
    expectString(response["threadId"], "feedback/save thread id");
    if (response["promptHash"] !== null)
      expectString(response["promptHash"], "feedback/save prompt hash");
  } catch (error) {
    if (error instanceof RpcResponseError && error.code === -32601) {
      throw new Error("Codex native diagnostics unsupported", { cause: error });
    }
    throw error;
  }
}
