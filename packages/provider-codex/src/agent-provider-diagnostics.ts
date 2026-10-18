import type { AgentProviderEvent } from "@codexly/core";

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

export function warnNotificationQueueRecovery(
  logger: CodexProviderLogger,
  projectId: string,
  method: string,
  taskId: string,
): void {
  logger.warn(
    {
      codexVersion: SUPPORTED_CODEX_VERSION,
      diagnosticCode: "notification_queue_recovery",
      method,
      taskId,
      projectId,
    },
    "Codex attachment notification recovered without attachment body",
  );
}
