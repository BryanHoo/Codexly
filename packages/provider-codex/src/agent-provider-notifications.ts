import type { AgentProviderEvent } from "@code-agent/core";
import type { AgentMcpServerFailureReason, AgentMcpServerStatus } from "@code-agent/protocol";

import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  isRecord,
} from "./codex-protocol-mapping.js";
import type { CodexMcpServerStartupStatus } from "./task-runtime-state.js";

const MAX_MCP_ERROR_LENGTH = 8_192;
const MCP_URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s]+/giu;
const MCP_SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gu;
const MCP_BEARER_TOKEN_PATTERN = /\b(Bearer)\s+[^\s]+/giu;

function sanitizeMcpStartupError(value: string): string {
  // Codex 原始错误用于现场诊断，但 URL 和常见凭证形态不得越过 Provider 边界。
  const redacted = value
    .replace(MCP_URL_PATTERN, "[URL redacted]")
    .replace(MCP_SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(MCP_BEARER_TOKEN_PATTERN, "$1 [REDACTED]");
  if (redacted.length <= MAX_MCP_ERROR_LENGTH) {
    return redacted;
  }
  const suffix = "\n[truncated]";
  return `${redacted.slice(0, MAX_MCP_ERROR_LENGTH - suffix.length)}${suffix}`;
}

function readMcpStartupState(value: unknown): AgentMcpServerStatus {
  if (value === "starting" || value === "ready" || value === "failed" || value === "cancelled") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex MCP startup status is invalid");
}

function readMcpFailureReason(value: unknown): AgentMcpServerFailureReason | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === "reauthenticationRequired") {
    return value;
  }
  throw new CodexProtocolMappingError("Codex MCP startup failure reason is invalid");
}

export function readMcpServerStartupStatus(value: unknown): Readonly<{
  name: string;
  status: CodexMcpServerStartupStatus;
  taskId: string;
}> {
  const params = expectRecord(value, "Codex MCP startup status params");
  const error = params["error"];
  if (error !== null && error !== undefined && typeof error !== "string") {
    throw new CodexProtocolMappingError("Codex MCP startup error must be a string or null");
  }
  return {
    name: expectString(params["name"], "Codex MCP server name"),
    status: {
      error: typeof error === "string" ? sanitizeMcpStartupError(error) : null,
      failureReason: readMcpFailureReason(params["failureReason"]),
      status: readMcpStartupState(params["status"]),
    },
    taskId: expectString(params["threadId"], "Codex MCP startup threadId"),
  };
}

export function readTaskId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value["threadId"] === "string") {
    return value["threadId"];
  }
  const thread = value["thread"];
  return isRecord(thread) && typeof thread["id"] === "string" ? thread["id"] : undefined;
}

export function mapCodexProjectStateNotification(
  method: string,
  value: unknown,
): AgentProviderEvent | undefined {
  const params = expectRecord(value, `Codex ${method} params`);
  if (method === "skills/changed") {
    return { payload: {}, taskId: "project", type: "skills.changed" };
  }

  const taskId = expectString(params["threadId"], `Codex ${method} threadId`);
  if (method === "thread/status/changed") {
    const status = expectRecord(params["status"], "Codex thread status")["type"];
    if (
      status !== "active" &&
      status !== "idle" &&
      status !== "notLoaded" &&
      status !== "systemError"
    ) {
      throw new CodexProtocolMappingError("Codex thread status is invalid");
    }
    return {
      payload: {
        status: status === "active" ? "running" : status === "systemError" ? "failed" : "idle",
      },
      taskId,
      type: "task.status_updated",
    };
  }
  if (method === "thread/name/updated") {
    return { payload: {}, taskId, type: "task.metadata_changed" };
  }
  if (method === "thread/queue/changed") {
    return { payload: {}, taskId, type: "queue.changed" };
  }
  if (method === "thread/archived" || method === "thread/deleted") {
    return {
      payload: { reason: method === "thread/archived" ? "archived" : "deleted" },
      taskId,
      type: "task.removed",
    };
  }
  return undefined;
}

export function readNotificationTurnId(method: string, value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (method === "turn/started" || method === "turn/completed") {
    const turn = value["turn"];
    return isRecord(turn) && typeof turn["id"] === "string" ? turn["id"] : undefined;
  }
  return typeof value["turnId"] === "string" ? value["turnId"] : undefined;
}

export function readNotificationItemType(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return undefined;
  }
  const type = value["item"]["type"];
  return typeof type === "string" ? type : undefined;
}

export function isFinalAgentMessage(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return false;
  }
  const item = value["item"];
  return (
    item["phase"] !== "commentary" &&
    typeof item["text"] === "string" &&
    item["text"].trim().length > 0
  );
}

export function isCommentaryAgentMessage(value: unknown): boolean {
  return isRecord(value) && isRecord(value["item"]) && value["item"]["phase"] === "commentary";
}

export function isReviewerFailureFallback(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value["item"])) {
    return false;
  }
  // Codex 会先发该占位终态，再由 reviewer 子 Thread 给出真正的中断或失败原因。
  return value["item"]["review"] === "Reviewer failed to output a response.";
}

export function readReviewWorkerThread(
  value: unknown,
): Readonly<{ parentTaskId: string; workerTaskId: string }> | undefined {
  if (!isRecord(value) || !isRecord(value["thread"])) {
    return undefined;
  }
  const thread = value["thread"];
  const source = thread["source"];
  if (
    typeof thread["id"] !== "string" ||
    typeof thread["parentThreadId"] !== "string" ||
    !isRecord(source) ||
    source["subAgent"] !== "review"
  ) {
    return undefined;
  }
  return {
    parentTaskId: thread["parentThreadId"],
    workerTaskId: thread["id"],
  };
}
