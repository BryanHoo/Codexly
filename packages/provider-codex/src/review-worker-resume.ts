import type { CodexRpcClient } from "./codex-rpc-client.js";
import type { CodexProviderLogger } from "./agent-provider-logger.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";
import {
  CODEX_THREAD_CONFIG,
  CodexProtocolMappingError,
  expectRecord,
  expectString,
} from "./codex-protocol-mapping.js";

export async function resumeReviewWorker(
  client: CodexRpcClient,
  logger: CodexProviderLogger,
  projectId: string,
  workerTaskId: string,
): Promise<void> {
  try {
    const response = expectRecord(
      await client.request("thread/resume", {
        config: CODEX_THREAD_CONFIG,
        threadId: workerTaskId,
      }),
      "review worker thread/resume response",
    );
    const thread = expectRecord(response["thread"], "review worker thread/resume thread");
    if (expectString(thread["id"], "review worker resumed thread id") !== workerTaskId) {
      throw new CodexProtocolMappingError(
        "review worker thread/resume returned a different thread",
      );
    }
  } catch {
    // Snapshot 会补偿订阅建立前的事件；恢复失败不能中断父 Task 的审查生命周期。
    logger.warn(
      {
        codexVersion: SUPPORTED_CODEX_VERSION,
        diagnosticCode: "review_worker_resume_failed",
        projectId,
        taskId: workerTaskId,
      },
      "Codex review worker resume failed",
    );
  }
}
