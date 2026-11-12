import { randomUUID } from "node:crypto";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk/unstable";
import type { PendingRequest } from "@codexly/protocol";
import {
  PendingRequestResolutionError,
  type AgentProviderEventListener,
  type ResolvePendingRequestInput,
} from "@codexly/core";
type Active = Extract<PendingRequest, { type: "tool_approval" }> & { status: "pending" };
interface Waiting {
  request: Active;
  resolve: (response: RequestPermissionResponse) => void;
  signal: AbortSignal;
  abort: () => void;
}
/** 原始 ACP 选项是授权依据；旧审批按钮仅兼容一次性选择，不能自动扩大授权。 */
export class AcpPermissions {
  readonly #waiting = new Map<string, Waiting>();
  readonly #cancelledTurns = new Map<string, string>();
  #closed = false;
  constructor(
    readonly projectId: string,
    readonly emit: AgentProviderEventListener,
  ) {}
  list(taskId: string): Active[] {
    return [...this.#waiting.values()]
      .filter((entry) => entry.request.taskId === taskId)
      .map((entry) => structuredClone(entry.request));
  }
  request(
    taskId: string,
    turnId: string,
    input: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    if (this.#closed || signal.aborted || this.#cancelledTurns.get(taskId) === turnId)
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    if (this.#waiting.size >= 64 || input.options.length > 128)
      return Promise.reject(new Error("ACP 审批请求超过容量限制"));
    const request: Active = {
      requestId: randomUUID(),
      projectId: this.projectId,
      taskId,
      turnId,
      itemId: `acp:tool:${input.toolCall.toolCallId}`,
      type: "tool_approval",
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      toolName: input.toolCall.title?.trim() ? input.toolCall.title : input.toolCall.toolCallId,
      reason: null,
      input: input.toolCall.rawInput ?? null,
      availableDecisions: input.options.some((o) => o.kind === "allow_once")
        ? ["allow", "deny"]
        : ["deny"],
      acpOptions: structuredClone(input.options),
    };
    return new Promise((resolve) => {
      const abort = () => {
        this.#settle(request.requestId, { outcome: { outcome: "cancelled" } }, "expired");
      };
      this.#waiting.set(request.requestId, { request, resolve, signal, abort });
      signal.addEventListener("abort", abort, { once: true });
      this.emit({
        type: "pending_request.created",
        taskId,
        turnId,
        itemId: request.itemId,
        payload: { request: structuredClone(request) },
      });
    });
  }
  /** 仅取消目标回合，迟到请求也返回 cancelled；标记受运行中会话容量限制。 */
  cancelTurn(taskId: string, turnId: string): void {
    this.#cancelledTurns.set(taskId, turnId);
    for (const [id, entry] of this.#waiting) {
      if (entry.request.taskId === taskId && entry.request.turnId === turnId)
        this.#settle(id, { outcome: { outcome: "cancelled" } }, "expired");
    }
  }
  finishTurn(taskId: string, turnId: string): void {
    if (this.#cancelledTurns.get(taskId) === turnId) this.#cancelledTurns.delete(taskId);
  }
  resolve(input: ResolvePendingRequestInput): PendingRequest {
    const entry = this.#waiting.get(input.requestId);
    if (!entry) throw new PendingRequestResolutionError("not_found", "ACP 审批请求已结束");
    const request = entry.request;
    if (
      input.type !== "tool_approval" ||
      input.taskId !== request.taskId ||
      input.turnId !== request.turnId ||
      input.itemId !== request.itemId ||
      input.projectId !== request.projectId
    )
      throw new PendingRequestResolutionError("mismatch", "ACP 审批身份不匹配");
    const { decision, optionId } = input.resolution;
    const option = optionId
      ? request.acpOptions?.find((o) => o.optionId === optionId)
      : request.acpOptions?.find(
          (o) =>
            o.kind ===
            (decision === "allow" ? "allow_once" : decision === "deny" ? "reject_once" : ""),
        );
    if (!option) {
      if (decision === "deny" && !optionId)
        return this.#settle(request.requestId, { outcome: { outcome: "cancelled" } }, "resolved");
      throw new PendingRequestResolutionError("mismatch", "ACP 审批选项不可用");
    }
    if (option.kind.startsWith("allow") === (decision === "deny"))
      throw new PendingRequestResolutionError("mismatch", "ACP 审批选项与决定不匹配");
    return this.#settle(
      request.requestId,
      { outcome: { outcome: "selected", optionId: option.optionId } },
      "resolved",
    );
  }
  #settle(
    id: string,
    response: RequestPermissionResponse,
    status: "resolved" | "expired",
  ): PendingRequest {
    const entry = this.#waiting.get(id);
    if (!entry) throw new PendingRequestResolutionError("not_found", "ACP 审批请求已结束");
    this.#waiting.delete(id);
    entry.signal.removeEventListener("abort", entry.abort);
    const { taskId, turnId, itemId } = entry.request;
    if (status === "resolved")
      this.emit({
        type: "pending_request.resolved",
        taskId,
        turnId,
        itemId,
        payload: { request: { ...entry.request, status: "resolved" } },
      });
    else
      this.emit({
        type: "pending_request.expired",
        taskId,
        turnId,
        itemId,
        payload: { request: { ...entry.request, status: "expired" } },
      });
    entry.resolve(response);
    return { ...entry.request, status };
  }
  close(): void {
    this.#closed = true;
    for (const id of this.#waiting.keys())
      this.#settle(id, { outcome: { outcome: "cancelled" } }, "expired");
    this.#cancelledTurns.clear();
  }
}
