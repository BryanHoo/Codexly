import {
  PendingRequestResolutionError,
  type AgentProviderEvent,
  type ResolvePendingRequestInput,
} from "@codexly/core";
import type { PendingRequest } from "@codexly/protocol";

import {
  type PendingCodexRequest,
  userInputAnswersMatchRequest,
} from "./codex-protocol-mapping.js";
import type { RpcRequestId } from "./jsonl-rpc-client.js";
import { mcpElicitationContentMatchesRequest } from "./codex-mcp-elicitation-mapping.js";

const MAX_TERMINAL_PENDING_REQUESTS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ResolvingPendingRequest = Readonly<{
  answerItem?: UserInputAnswerItem;
  fingerprint: string;
  status: "expired" | "resolved";
  promise: Promise<PendingRequest>;
}>;

type UserInputAnswerItem = Readonly<{
  id: string;
  role: "user";
  text: string;
  type: "message";
}>;

function createUserInputAnswerItem(
  request: Extract<PendingRequest, { type: "user_input" }>,
  answers: Readonly<Record<string, readonly string[]>>,
): UserInputAnswerItem {
  // Codex 只发送 resolved 通知，Provider 需要补出可流式展示的用户回答，同时隐藏密文。
  const text = request.questions
    .map((question) => {
      const answer = question.isSecret ? "******" : (answers[question.id]?.[0] ?? "");
      return `- ${question.header}: ${answer}`;
    })
    .join("\n");
  return {
    id: `user-input-answer-${request.requestId}`,
    role: "user",
    text,
    type: "message",
  };
}

export interface PendingRequestLifecycleOptions {
  publish: (event: AgentProviderEvent) => void;
  respond: (id: RpcRequestId, result: unknown) => Promise<void> | void;
}

/** 负责 Pending Request 的响应、自动过期和单终态发布。 */
export class PendingRequestLifecycle {
  readonly #pendingRequests = new Map<string, PendingCodexRequest>();
  readonly #publish: (event: AgentProviderEvent) => void;
  readonly #requestExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #respond: PendingRequestLifecycleOptions["respond"];
  readonly #resolvingRequests = new Map<string, ResolvingPendingRequest>();
  readonly #terminalRequests = new Map<string, PendingRequest>();

  public constructor(options: PendingRequestLifecycleOptions) {
    this.#publish = options.publish;
    this.#respond = options.respond;
  }

  public activate(entry: PendingCodexRequest): void {
    if (this.has(entry.request.requestId)) {
      return;
    }
    this.#pendingRequests.set(entry.request.requestId, entry);
    this.#scheduleExpiry(entry);
    this.#publish({
      itemId: entry.request.itemId,
      payload: { request: entry.request },
      taskId: entry.request.taskId,
      turnId: entry.request.turnId,
      type: "pending_request.created",
    });
  }

  public has(requestId: string): boolean {
    return this.#pendingRequests.has(requestId) || this.#terminalRequests.has(requestId);
  }

  public hasForTask(taskId: string): boolean {
    return [...this.#pendingRequests.values()].some((entry) => entry.request.taskId === taskId);
  }

  public pendingForTask(taskId: string): (PendingRequest & { status: "pending" })[] {
    return [...this.#pendingRequests.values()]
      .map((entry) => entry.request)
      .filter((request) => request.taskId === taskId);
  }

  public resolve(input: ResolvePendingRequestInput): Promise<PendingRequest> {
    const entry = this.#pendingRequests.get(input.requestId);
    if (entry === undefined) {
      const terminal = this.#terminalRequests.get(input.requestId);
      if (terminal !== undefined) {
        throw new PendingRequestResolutionError(
          terminal.status === "resolved" ? "resolved" : "expired",
          `Pending request is already ${terminal.status}`,
        );
      }
      throw new PendingRequestResolutionError("not_found", "Pending request was not found");
    }
    const request = entry.request;
    if (
      request.projectId !== input.projectId ||
      request.taskId !== input.taskId ||
      request.turnId !== input.turnId ||
      request.itemId !== input.itemId ||
      request.type !== input.type
    ) {
      throw new PendingRequestResolutionError(
        "mismatch",
        "Pending request identity does not match",
      );
    }

    let answerItem: UserInputAnswerItem | undefined;
    let result: unknown;
    if (input.type === "mcp_elicitation") {
      if (request.type !== "mcp_elicitation") {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      const resolution = input.resolution;
      if (
        resolution.action === "accept" &&
        !mcpElicitationContentMatchesRequest(request, resolution.content)
      ) {
        throw new PendingRequestResolutionError(
          "mismatch",
          "MCP elicitation content does not match the requested form",
        );
      }
      // MCP 明确区分接受、拒绝与取消，且拒绝或取消时 content 必须为 null。
      result = resolution;
    } else if (input.type === "permissions_approval") {
      if (request.type !== "permissions_approval" || entry.nativePermissionProfile === undefined) {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      const granted = input.resolution.grantedPermissions;
      const nativePermissions: Record<string, unknown> = {};
      for (const category of granted) {
        const nativeCategory =
          category === "network"
            ? entry.nativePermissionProfile.network
            : entry.nativePermissionProfile.fileSystem;
        if (nativeCategory === null) {
          throw new PendingRequestResolutionError(
            "mismatch",
            "Granted permission was not requested",
          );
        }
        nativePermissions[category === "network" ? "network" : "fileSystem"] = nativeCategory;
      }
      // 原生协议只接受请求权限的子集；空集合表示拒绝且不扩大 Sandbox。
      result = { permissions: nativePermissions, scope: input.resolution.scope };
    } else if (input.type === "user_input") {
      if (request.type !== "user_input") {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      if (!userInputAnswersMatchRequest(request, input.resolution.answers)) {
        throw new PendingRequestResolutionError(
          "mismatch",
          "User input answers do not match the pending questions",
        );
      }
      result = {
        answers: Object.fromEntries(
          request.questions.map((question) => [
            question.id,
            { answers: input.resolution.answers[question.id] },
          ]),
        ),
      };
      answerItem = createUserInputAnswerItem(request, input.resolution.answers);
    } else {
      if (
        request.type === "user_input" ||
        request.type === "permissions_approval" ||
        request.type === "mcp_elicitation"
      ) {
        throw new PendingRequestResolutionError("mismatch", "Pending request type does not match");
      }
      const decision = input.resolution.decision;
      if (!request.availableDecisions.includes(decision)) {
        throw new PendingRequestResolutionError(
          "mismatch",
          "Approval decision is not available for this request",
        );
      }
      result = {
        decision:
          decision === "allow"
            ? "accept"
            : decision === "allow_for_session"
              ? "acceptForSession"
              : (entry.denyDecision ?? "decline"),
      };
    }

    const fingerprint = JSON.stringify(result);
    const resolvingRequest = this.#resolvingRequests.get(input.requestId);
    if (resolvingRequest !== undefined) {
      if (resolvingRequest.fingerprint !== fingerprint) {
        throw new PendingRequestResolutionError(
          "resolved",
          "Pending request is already resolving with another response",
        );
      }
      return resolvingRequest.promise;
    }
    if (request.expiresAt !== null && Date.now() >= Date.parse(request.expiresAt)) {
      this.#expire(entry);
      throw new PendingRequestResolutionError("expired", "Pending request expired");
    }
    return this.#beginResolution(entry, result, fingerprint, "resolved", answerItem);
  }

  public handleResolved(requestId: string, taskId: string): boolean {
    const entry = this.#pendingRequests.get(requestId);
    if (entry === undefined) {
      return false;
    }
    if (entry.request.taskId === taskId) {
      const resolving = this.#resolvingRequests.get(requestId);
      this.#terminalize(entry, resolving?.status ?? "expired", resolving?.answerItem);
    }
    return true;
  }

  public expireTurn(taskId: string, turnId: string): void {
    for (const entry of [...this.#pendingRequests.values()]) {
      if (entry.request.taskId === taskId && entry.request.turnId === turnId) {
        this.#terminalize(entry, "expired");
      }
    }
  }

  public clearTask(taskId: string): void {
    for (const entry of [...this.#pendingRequests.values()]) {
      if (entry.request.taskId === taskId) {
        this.#pendingRequests.delete(entry.request.requestId);
        this.#clearExpiryTimer(entry.request.requestId);
        this.#resolvingRequests.delete(entry.request.requestId);
      }
    }
    for (const [requestId, request] of this.#terminalRequests) {
      if (request.taskId === taskId) {
        this.#terminalRequests.delete(requestId);
      }
    }
  }

  public clear(): void {
    for (const timer of this.#requestExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.#pendingRequests.clear();
    this.#requestExpiryTimers.clear();
    this.#resolvingRequests.clear();
    this.#terminalRequests.clear();
  }

  #beginResolution(
    entry: PendingCodexRequest,
    result: unknown,
    fingerprint: string,
    status: "expired" | "resolved",
    answerItem?: UserInputAnswerItem,
  ): Promise<PendingRequest> {
    const requestId = entry.request.requestId;
    // 响应失败时保留到期定时器，让自动过期仍可接管。
    const promise = Promise.resolve()
      .then(() => this.#respond(entry.providerRequestId, result))
      .then(
        () => this.#terminalize(entry, status, answerItem),
        (error: unknown) => {
          const terminalRequest = this.#terminalRequests.get(requestId);
          if (terminalRequest?.status === "resolved") {
            return terminalRequest;
          }
          throw error;
        },
      );
    const resolving = {
      ...(answerItem === undefined ? {} : { answerItem }),
      fingerprint,
      promise,
      status,
    };
    this.#resolvingRequests.set(requestId, resolving);
    const clearResolution = () => {
      if (this.#resolvingRequests.get(requestId) === resolving) {
        this.#resolvingRequests.delete(requestId);
      }
    };
    void promise.then(clearResolution, clearResolution);
    return promise;
  }

  #scheduleExpiry(entry: PendingCodexRequest): void {
    if (entry.request.type !== "user_input" || entry.request.expiresAt === null) {
      return;
    }
    const schedule = () => {
      if (this.#pendingRequests.get(entry.request.requestId) !== entry) {
        return;
      }
      const remainingMs = Date.parse(entry.request.expiresAt ?? "") - Date.now();
      if (remainingMs <= 0) {
        this.#requestExpiryTimers.delete(entry.request.requestId);
        this.#expire(entry);
        return;
      }
      const timer = setTimeout(schedule, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
      timer.unref();
      this.#requestExpiryTimers.set(entry.request.requestId, timer);
    };
    schedule();
  }

  #expire(entry: PendingCodexRequest): void {
    if (this.#pendingRequests.get(entry.request.requestId) !== entry) {
      return;
    }
    const resolving = this.#resolvingRequests.get(entry.request.requestId);
    if (resolving !== undefined) {
      void resolving.promise.catch(() => {
        this.#expire(entry);
      });
      return;
    }
    const expiration = this.#beginResolution(entry, { answers: {} }, "auto-expire", "expired");
    void expiration.catch(() => {
      if (this.#pendingRequests.get(entry.request.requestId) === entry) {
        this.#terminalize(entry, "expired");
      }
    });
  }

  #clearExpiryTimer(requestId: string): void {
    const timer = this.#requestExpiryTimers.get(requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#requestExpiryTimers.delete(requestId);
    }
  }

  #terminalize(
    entry: PendingCodexRequest,
    status: "expired" | "resolved",
    answerItem?: UserInputAnswerItem,
  ): PendingRequest {
    if (!this.#pendingRequests.delete(entry.request.requestId)) {
      return this.#terminalRequests.get(entry.request.requestId) ?? entry.request;
    }
    this.#clearExpiryTimer(entry.request.requestId);
    const request =
      status === "resolved"
        ? ({ ...entry.request, status: "resolved" } as PendingRequest & { status: "resolved" })
        : ({ ...entry.request, status: "expired" } as PendingRequest & { status: "expired" });
    this.#terminalRequests.set(request.requestId, request);
    if (this.#terminalRequests.size > MAX_TERMINAL_PENDING_REQUESTS) {
      const oldestRequestId = this.#terminalRequests.keys().next().value;
      if (oldestRequestId !== undefined) {
        this.#terminalRequests.delete(oldestRequestId);
      }
    }
    if (request.status === "resolved") {
      this.#publish({
        itemId: request.itemId,
        payload: { request },
        taskId: request.taskId,
        turnId: request.turnId,
        type: "pending_request.resolved",
      });
      if (answerItem !== undefined) {
        this.#publish({
          itemId: answerItem.id,
          payload: { item: answerItem },
          taskId: request.taskId,
          turnId: request.turnId,
          type: "item.completed",
        });
      }
    } else {
      this.#publish({
        itemId: request.itemId,
        payload: { request },
        taskId: request.taskId,
        turnId: request.turnId,
        type: "pending_request.expired",
      });
    }
    return request;
  }
}
