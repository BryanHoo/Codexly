import type { AgentProviderEvent } from "@code-agent/core";

import type { CodexProviderLogger } from "./agent-provider-logger.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";
import type { RpcServerRequest } from "./jsonl-rpc-client.js";
import { readTaskId } from "./agent-provider-notifications.js";

export function warnDroppedCodexNotification(
  logger: CodexProviderLogger,
  projectId: string,
  diagnosticCode: "invalid_notification" | "unknown_notification",
  method: string,
  params: unknown,
): void {
  // 原始通知可能包含 Prompt、命令或文件正文，诊断日志只保留关联身份。
  logger.warn(
    {
      codexVersion: SUPPORTED_CODEX_VERSION,
      diagnosticCode,
      method,
      projectId,
      taskId: readTaskId(params) ?? null,
    },
    "Codex notification dropped",
  );
}

export function warnEventListenerFailure(
  logger: CodexProviderLogger,
  projectId: string,
  event: AgentProviderEvent,
): void {
  logger.warn(
    {
      codexVersion: SUPPORTED_CODEX_VERSION,
      diagnosticCode: "event_listener_failed",
      eventType: event.type,
      projectId,
      taskId: event.taskId,
    },
    "Codex event listener failed",
  );
}

export function warnServerRequestRejectionFailure(
  logger: CodexProviderLogger,
  projectId: string,
  request: RpcServerRequest,
): void {
  logger.warn(
    {
      codexVersion: SUPPORTED_CODEX_VERSION,
      diagnosticCode: "server_request_rejection_failed",
      method: request.method,
      projectId,
      taskId: readTaskId(request.params) ?? null,
    },
    "Codex server request rejection failed",
  );
}
