import type { AgentProviderEvent } from "@code-agent/core";
import type {
  AgentItem,
  AgentMessageAttachment,
  AgentPlan,
  AgentPlanStepStatus,
  AgentReviewTarget,
} from "@code-agent/protocol";

import {
  CODEX_MAPPED_NOTIFICATION_METHODS,
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  isRecord,
  optionalInteger,
  optionalString,
} from "./codex-mapping-common.js";
import { mapRealtimeFileChanges } from "./codex-diff-mapping.js";
import { mapAgentItem, mapApprovalReviewItem } from "./codex-item-mapping.js";
import { mapContextUsage, mapAgentTurn } from "./codex-task-mapping.js";
import {
  createReviewItem,
  inferReviewTargetFromPrompt,
  mapReviewHint,
  markStartedItemRunning,
} from "./codex-tool-mapping.js";

const MAX_STATUS_TEXT_LENGTH = 8_192;

function boundStatusText(value: string): string {
  return value.slice(0, MAX_STATUS_TEXT_LENGTH);
}

function expectNonNegativeInteger(value: unknown, context: string): number {
  const parsed = optionalInteger(value);
  if (parsed === undefined || parsed < 0) {
    throw new CodexProtocolMappingError(`${context} must be a non-negative integer`);
  }
  return parsed;
}

function mapHookStatus(value: unknown): Extract<AgentItem, { type: "runtime_status" }>["status"] {
  if (value === "running" || value === "completed" || value === "failed") return value;
  if (value === "blocked") return "failed";
  if (value === "stopped") return "interrupted";
  throw new CodexProtocolMappingError("Codex hook status is invalid");
}

type ProviderErrorCode = NonNullable<
  Extract<AgentProviderEvent, { type: "provider.error" }>["payload"]["code"]
>;

function mapProviderErrorInfo(value: unknown): Readonly<{
  code?: ProviderErrorCode;
  httpStatusCode?: number;
}> {
  if (value === null || value === undefined) return {};
  const scalarCodes: Readonly<Record<string, ProviderErrorCode>> = {
    badRequest: "bad_request",
    contextWindowExceeded: "context_window_exceeded",
    cyberPolicy: "policy_blocked",
    internalServerError: "internal_error",
    other: "other",
    sandboxError: "sandbox_error",
    serverOverloaded: "server_overloaded",
    sessionBudgetExceeded: "session_budget_exceeded",
    unauthorized: "unauthorized",
    usageLimitExceeded: "usage_limit_exceeded",
  };
  if (typeof value === "string") {
    return { code: scalarCodes[value] ?? "other" };
  }
  const info = expectRecord(value, "Codex error info");
  const connection =
    info["httpConnectionFailed"] ??
    info["responseStreamConnectionFailed"] ??
    info["responseStreamDisconnected"] ??
    info["responseTooManyFailedAttempts"];
  if (!isRecord(connection)) return { code: "other" };
  const httpStatusCode = optionalInteger(connection["httpStatusCode"]);
  return {
    code: "connection_failed",
    ...(httpStatusCode === undefined ? {} : { httpStatusCode }),
  };
}

function mapPlanStepStatus(value: unknown): AgentPlanStepStatus {
  if (value === "pending" || value === "completed") {
    return value;
  }
  if (value === "inProgress") {
    return "in_progress";
  }
  throw new CodexProtocolMappingError("Codex plan step status is invalid");
}

function mapPlan(value: Record<string, unknown>): AgentPlan {
  const explanation = value["explanation"];
  if (explanation !== null && typeof explanation !== "string") {
    throw new CodexProtocolMappingError("Codex plan explanation must be a string or null");
  }
  const nativeSteps = value["plan"];
  if (!Array.isArray(nativeSteps)) {
    throw new CodexProtocolMappingError("Codex plan must be an array");
  }
  return {
    explanation,
    steps: nativeSteps.map((value) => {
      const step = expectRecord(value, "Codex plan step");
      return {
        status: mapPlanStepStatus(step["status"]),
        text: expectString(step["step"], "Codex plan step text"),
      };
    }),
  };
}

export function mapCodexNotification(
  method: string,
  value: unknown,
  mapImage: (
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ) => AgentMessageAttachment | undefined,
  mapText: (
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ) => AgentMessageAttachment | undefined,
  reviewTarget?: AgentReviewTarget,
  explicitTurnId?: string,
  reviewWorker = false,
  suppressReviewResult = false,
  explicitTaskId?: string,
): AgentProviderEvent | undefined {
  if (!CODEX_MAPPED_NOTIFICATION_METHODS.has(method)) {
    return undefined;
  }

  const params = expectRecord(value, `Codex ${method} params`);
  if (method === "warning" && params["threadId"] === null && explicitTaskId === undefined) {
    // 进程级 Warning 没有可验证的 Task 归属，不能伪造路由到当前页面。
    return undefined;
  }
  const taskId = explicitTaskId ?? expectString(params["threadId"], `Codex ${method} threadId`);

  if (method === "autoApprovalReview/strictReviewRequired") {
    expectNonNegativeInteger(params["startedAtMs"], "Codex strict review startedAtMs");
    expectString(params["turnId"], "Codex strict review turnId");
    return {
      payload: {
        code: "strict_review_required",
        level: "warning",
        message: "Strict review is required before this action can continue.",
      },
      taskId,
      type: "task.notice",
    };
  }

  if (method === "warning" || method === "guardianWarning") {
    return {
      payload: {
        code: method === "guardianWarning" ? "guardian_warning" : "runtime_warning",
        level: "warning",
        message: boundStatusText(expectString(params["message"], `Codex ${method} message`)),
      },
      taskId,
      type: "task.notice",
    };
  }

  if (method === "model/verification") {
    return {
      payload: {
        code: "model_verification",
        level: "warning",
        message: "Model access verification is required.",
      },
      taskId,
      type: "task.notice",
    };
  }

  if (method === "thread/tokenUsage/updated") {
    return {
      payload: { usage: mapContextUsage(params["tokenUsage"]) },
      taskId,
      turnId: explicitTurnId ?? expectString(params["turnId"], "Codex token usage turnId"),
      type: "usage.updated",
    };
  }

  if (method === "turn/plan/updated") {
    return {
      payload: { plan: mapPlan(params) },
      taskId,
      turnId: explicitTurnId ?? expectString(params["turnId"], "Codex plan turnId"),
      type: "plan.updated",
    };
  }

  if (method === "turn/started" || method === "turn/completed") {
    const turn = mapAgentTurn(
      params["turn"],
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
      reviewTarget,
      explicitTurnId,
      reviewWorker,
      suppressReviewResult,
    );
    return {
      payload: { turn },
      taskId,
      turnId: turn.id,
      type: method === "turn/started" ? "turn.started" : "turn.completed",
    };
  }

  if (method === "hook/started" || method === "hook/completed") {
    const run = expectRecord(params["run"], "Codex hook run");
    const nativeDuration = optionalInteger(run["durationMs"]);
    const detail = optionalString(run["statusMessage"]);
    const item: Extract<AgentItem, { type: "runtime_status" }> = {
      ...(detail === undefined ? {} : { detail: boundStatusText(detail) }),
      ...(nativeDuration === undefined ? {} : { durationMs: nativeDuration }),
      eventName: expectString(run["eventName"], "Codex hook event name"),
      id: `hook-${expectString(run["id"], "Codex hook run id")}`,
      kind: "hook",
      status: method === "hook/started" ? "running" : mapHookStatus(run["status"]),
      type: "runtime_status",
    };
    const hookTurnId = explicitTurnId ?? optionalString(params["turnId"]);
    if (hookTurnId === undefined) {
      return {
        payload: {
          code: "hook_status",
          level: item.status === "failed" ? "warning" : "info",
          message: item.detail ?? item.eventName,
        },
        taskId,
        type: "task.notice",
      };
    }
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId: hookTurnId,
      type: method === "hook/started" ? "item.started" : "item.completed",
    };
  }

  const turnId = explicitTurnId ?? expectString(params["turnId"], `Codex ${method} turnId`);
  if (method === "error") {
    const error = expectRecord(params["error"], "Codex error notification error");
    if (typeof params["willRetry"] !== "boolean") {
      throw new CodexProtocolMappingError("Codex error notification willRetry must be a boolean");
    }
    const errorInfo = mapProviderErrorInfo(error["codexErrorInfo"]);
    return {
      payload: {
        ...errorInfo,
        message: expectString(error["message"], "Codex error notification message"),
        willRetry: params["willRetry"],
      },
      taskId,
      turnId,
      type: "provider.error",
    };
  }

  if (method === "item/plan/delta") {
    return {
      itemId: expectString(params["itemId"], "Codex plan delta itemId"),
      payload: { delta: expectString(params["delta"], "Codex plan delta") },
      taskId,
      turnId,
      type: "plan.delta",
    };
  }

  if (method === "item/mcpToolCall/progress") {
    return {
      itemId: expectString(params["itemId"], "Codex MCP progress itemId"),
      payload: {
        message: boundStatusText(expectString(params["message"], "Codex MCP progress message")),
      },
      taskId,
      turnId,
      type: "tool.progress",
    };
  }

  if (method === "item/fileChange/patchUpdated") {
    return {
      itemId: expectString(params["itemId"], "Codex file change itemId"),
      payload: mapRealtimeFileChanges(params["changes"]),
      taskId,
      turnId,
      type: "file_change.updated",
    };
  }

  if (method === "item/reasoning/summaryPartAdded") {
    return {
      itemId: expectString(params["itemId"], "Codex reasoning itemId"),
      payload: {
        delta: "",
        field: "summary",
        sectionIndex: expectNonNegativeInteger(params["summaryIndex"], "Codex summary index"),
      },
      taskId,
      turnId,
      type: "reasoning.delta",
    };
  }

  if (method === "model/safetyBuffering/updated") {
    const model = expectString(params["model"], "Codex safety buffering model");
    const fasterModel = optionalString(params["fasterModel"]);
    if (typeof params["showBufferingUi"] !== "boolean") {
      throw new CodexProtocolMappingError("Codex safety buffering UI state is invalid");
    }
    const item: Extract<AgentItem, { kind: "safety_buffering" }> = {
      ...(fasterModel === undefined ? {} : { fasterModel }),
      id: `runtime-safety-${turnId}`,
      kind: "safety_buffering",
      model,
      status: params["showBufferingUi"] ? "running" : "completed",
      type: "runtime_status",
    };
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: params["showBufferingUi"] ? "item.started" : "item.completed",
    };
  }

  if (method === "model/rerouted") {
    const item: Extract<AgentItem, { kind: "model_rerouted" }> = {
      fromModel: expectString(params["fromModel"], "Codex previous model"),
      id: `runtime-reroute-${turnId}`,
      kind: "model_rerouted",
      status: "completed",
      toModel: expectString(params["toModel"], "Codex routed model"),
      type: "runtime_status",
    };
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.completed",
    };
  }

  if (
    method === "item/autoApprovalReview/started" ||
    method === "item/autoApprovalReview/completed"
  ) {
    const item = mapApprovalReviewItem(params);
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: method === "item/autoApprovalReview/started" ? "item.started" : "item.completed",
    };
  }

  if (method === "item/started") {
    const nativeItem = expectRecord(params["item"], "Codex started item");
    if (nativeItem["type"] === "enteredReviewMode") {
      const item = createReviewItem(
        turnId,
        reviewTarget ?? mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint")),
      );
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.started" };
    }
    // 文本与推理由专用 Delta 创建；结构化操作必须立即交付当前运行状态。
    if (
      nativeItem["type"] === "userMessage" ||
      nativeItem["type"] === "agentMessage" ||
      nativeItem["type"] === "reasoning" ||
      nativeItem["type"] === "exitedReviewMode"
    ) {
      return undefined;
    }
    const item = markStartedItemRunning(mapAgentItem(nativeItem));
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.started",
    };
  }

  if (method === "item/completed") {
    const nativeItem = expectRecord(params["item"], "Codex completed item");
    const promptReviewTarget = inferReviewTargetFromPrompt(nativeItem);
    if (nativeItem["type"] === "userMessage" && reviewTarget !== undefined) {
      return undefined;
    }
    if (nativeItem["type"] === "enteredReviewMode" || promptReviewTarget !== undefined) {
      const target =
        reviewTarget ??
        promptReviewTarget ??
        mapReviewHint(expectString(nativeItem["review"], "Codex review mode hint"));
      const item = createReviewItem(turnId, target);
      return { itemId: item.id, payload: { item }, taskId, turnId, type: "item.completed" };
    }
    const item = mapAgentItem(
      nativeItem,
      new Map(),
      (part, imageIndex) => mapImage(taskId, part, imageIndex),
      (input, textIndex) => mapText(taskId, input, textIndex),
    );
    return {
      itemId: item.id,
      payload: { item },
      taskId,
      turnId,
      type: "item.completed",
    };
  }

  const itemId = expectString(params["itemId"], `Codex ${method} itemId`);
  const delta = expectString(params["delta"], `Codex ${method} delta`);
  if (method === "item/agentMessage/delta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "message.delta" };
  }
  if (method === "item/commandExecution/outputDelta") {
    return { itemId, payload: { delta }, taskId, turnId, type: "command.output_delta" };
  }
  return {
    itemId,
    payload: {
      delta,
      field: method === "item/reasoning/summaryTextDelta" ? "summary" : "content",
      ...(method === "item/reasoning/summaryTextDelta"
        ? {
            sectionIndex: expectNonNegativeInteger(params["summaryIndex"], "Codex summary index"),
          }
        : {}),
    },
    taskId,
    turnId,
    type: "reasoning.delta",
  };
}
