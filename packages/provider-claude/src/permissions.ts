import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
  PendingRequestResolutionError,
  type AgentProviderEventListener,
  type ResolvePendingRequestInput,
} from "@codexly/core";
import type { PendingRequest } from "@codexly/protocol";
import { record } from "./turn-projection.js";
import { ClaudeSessionGrants, canReplaySessionGrants } from "./session-grants.js";

import { ClaudeElicitation } from "./elicitation.js";

type ToolOptions = Parameters<CanUseTool>[2];
type ActiveRequest = PendingRequest & { status: "pending" };
interface Entry {
  request: ActiveRequest;
  input: Record<string, unknown>;
  options: ToolOptions;
  settle: (result: PermissionResult) => void;
  cancel: () => void;
  promise: Promise<PermissionResult>;
}

const asText = (value: unknown, fallback: string) =>
  typeof value === "string" && value ? value : fallback;

export class ClaudePermissions {
  readonly #entries = new Map<string, Entry>();
  readonly elicitation: ClaudeElicitation;
  constructor(
    readonly projectId: string,
    readonly taskId: string,
    readonly turnId: string,
    readonly emit: AgentProviderEventListener,
    readonly sessionGrants = new ClaudeSessionGrants(),
  ) {
    this.elicitation = new ClaudeElicitation(projectId, taskId, turnId, emit);
  }

  pending(): ActiveRequest[] {
    return [...this.#entries.values()]
      .map((entry) => entry.request)
      .concat(this.elicitation.pending());
  }

  request: CanUseTool = (toolName, input, options) => {
    if (options.signal.aborted)
      return Promise.resolve({ behavior: "deny", message: "Request cancelled", interrupt: true });
    const existing = this.#entries.get(options.requestId);
    if (existing) return existing.promise;
    if (this.#entries.size >= 64)
      return Promise.resolve({
        behavior: "deny",
        message: "Permission request capacity exceeded",
        interrupt: true,
      });
    const identity = {
      projectId: this.projectId,
      taskId: this.taskId,
      turnId: this.turnId,
      itemId: options.toolUseID,
      requestId: options.requestId,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      status: "pending" as const,
    };
    let request: ActiveRequest;
    if (toolName === "AskUserQuestion" && Array.isArray(input["questions"])) {
      const questions = input["questions"].map((value, index) => {
        const question = record(value);
        return {
          id: String(index),
          type: "choice" as const,
          ...(question["multiSelect"] === true ? { multiSelect: true } : {}),
          header: asText(question["header"], "Question"),
          prompt: asText(question["question"], "Question"),
          isSecret: false,
          isOther: true,
          options: Array.isArray(question["options"])
            ? question["options"].map((option) => ({
                label: asText(record(option)["label"], "Option"),
                description: asText(record(option)["description"], ""),
              }))
            : [],
        };
      });
      request = { ...identity, type: "user_input", questions };
    } else {
      request = {
        ...identity,
        type: "tool_approval",
        toolName,
        input,
        reason: options.decisionReason ?? options.description ?? null,
        availableDecisions:
          canReplaySessionGrants(options.suggestions ?? []) && !options.suppressAlwaysAllowRule
            ? ["allow", "allow_for_session", "deny"]
            : ["allow", "deny"],
      };
    }
    const deferred = Promise.withResolvers<PermissionResult>();
    const cancel = () => {
      if (!this.#entries.delete(request.requestId)) return;
      options.signal.removeEventListener("abort", cancel);
      this.emit({
        type: "pending_request.expired",
        taskId: this.taskId,
        turnId: this.turnId,
        itemId: request.itemId,
        payload: { request: { ...request, status: "expired" } },
      });
      deferred.resolve({ behavior: "deny", message: "Request cancelled", interrupt: true });
    };
    this.#entries.set(request.requestId, {
      request,
      input,
      options,
      settle: deferred.resolve,
      cancel,
      promise: deferred.promise,
    });
    options.signal.addEventListener("abort", cancel, { once: true });
    this.emit({
      type: "pending_request.created",
      taskId: this.taskId,
      turnId: this.turnId,
      itemId: request.itemId,
      payload: { request },
    });
    return deferred.promise;
  };

  resolve(input: ResolvePendingRequestInput): PendingRequest {
    if (input.type === "mcp_elicitation") return this.elicitation.resolve(input);
    const entry = this.#entries.get(input.requestId);
    if (!entry)
      throw new PendingRequestResolutionError(
        "not_found",
        "Permission request is no longer pending",
      );
    const { request, options } = entry;
    if (
      ["projectId", "taskId", "turnId", "itemId", "type"].some(
        (key) => record(input)[key] !== record(request)[key],
      )
    )
      throw new PendingRequestResolutionError("mismatch", "Permission request identity mismatch");
    let result: PermissionResult;
    if (input.type === "user_input" && request.type === "user_input") {
      const answers: Record<string, string> = {};
      for (const question of request.questions) {
        const answer = input.resolution.answers[question.id];
        if (
          !answer?.length ||
          answer.some((part) => !part.trim()) ||
          (!(question.type === "choice" && question.multiSelect) && answer.length !== 1)
        )
          throw new PendingRequestResolutionError("mismatch", "Every question requires an answer");
        answers[question.prompt] = answer.join(", ");
      }
      result = { behavior: "allow", updatedInput: { ...entry.input, answers } };
    } else if (input.type === "tool_approval" && request.type === "tool_approval") {
      const decision = input.resolution.decision;
      if (!request.availableDecisions.includes(decision))
        throw new PendingRequestResolutionError("mismatch", "Permission decision is unavailable");
      // SDK 建议中的路径/命令规则原样保留，仅缩小持久范围到 session，绝不提升为整工具放行。
      result =
        decision === "deny"
          ? { behavior: "deny", message: "User denied this tool call" }
          : {
              behavior: "allow",
              updatedInput: entry.input,
              ...(decision === "allow_for_session"
                ? {
                    updatedPermissions: (options.suggestions ?? []).map((suggestion) => ({
                      ...suggestion,
                      destination: "session" as const,
                    })),
                  }
                : {}),
            };
    } else throw new PendingRequestResolutionError("mismatch", "Unsupported permission response");
    // 在解除审批等待前保存精确规则，保证下一次查询创建时已能恢复授权。
    if (result.behavior === "allow" && result.updatedPermissions?.length)
      this.sessionGrants.remember(result.updatedPermissions);
    this.#entries.delete(input.requestId);
    options.signal.removeEventListener("abort", entry.cancel);
    const resolved = { ...request, status: "resolved" as const };
    this.emit({
      type: "pending_request.resolved",
      taskId: this.taskId,
      turnId: this.turnId,
      itemId: request.itemId,
      payload: { request: resolved },
    });
    entry.settle(result);
    return resolved;
  }

  close(): void {
    this.elicitation.close();
    for (const entry of this.#entries.values()) entry.cancel();
  }
}
