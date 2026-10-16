import type { OnElicitation, ElicitationResult } from "@anthropic-ai/claude-agent-sdk";
import {
  mapMcpElicitationFormFields,
  mapMcpElicitationSafeUrl,
  mcpElicitationContentMatchesRequest,
  PendingRequestResolutionError,
  type AgentProviderEventListener,
  type ResolvePendingRequestInput,
} from "@codexly/core";
import type { PendingRequest } from "@codexly/protocol";

type Request = Extract<PendingRequest, { type: "mcp_elicitation" }> & { status: "pending" };

/** 复用审批的生命周期入口，但保留 MCP 独立的动作和内容语义。 */
export class ClaudeElicitation {
  readonly #entries = new Map<
    string,
    {
      request: Request;
      promise: Promise<ElicitationResult>;
      finish: (result?: ElicitationResult) => PendingRequest;
    }
  >();
  constructor(
    readonly projectId: string,
    readonly taskId: string,
    readonly turnId: string,
    readonly emit: AgentProviderEventListener,
  ) {}

  pending(): Request[] {
    return [...this.#entries.values()].map((entry) => entry.request);
  }

  request: OnElicitation = (input, options) => {
    if (options.signal.aborted) return Promise.resolve({ action: "cancel" });
    // 独立命名空间防止 SDK 控制请求与工具审批 ID 相撞。
    const requestId = `mcp-elicitation:${options.requestId}`;
    const existing = this.#entries.get(requestId);
    if (existing) return existing.promise;
    if (this.#entries.size >= 64) return Promise.resolve({ action: "decline" });
    const identity = {
      projectId: this.projectId,
      taskId: this.taskId,
      turnId: this.turnId,
      requestId,
      itemId: requestId,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      status: "pending" as const,
      type: "mcp_elicitation" as const,
      serverName: input.serverName,
      message: input.message,
    };
    let request: Request;
    try {
      request =
        input.mode === "url"
          ? { ...identity, mode: "url", url: mapMcpElicitationSafeUrl(input.url) }
          : {
              ...identity,
              mode: "form",
              fields: mapMcpElicitationFormFields(input.requestedSchema),
            };
    } catch {
      // 无法安全展示的请求直接拒绝，不向界面发送无效协议或危险 URL。
      return Promise.resolve({ action: "decline" });
    }
    const deferred = Promise.withResolvers<ElicitationResult>();
    const finish = (result?: ElicitationResult): PendingRequest => {
      this.#entries.delete(requestId);
      options.signal.removeEventListener("abort", cancel);
      const settled = { ...request, status: result ? ("resolved" as const) : ("expired" as const) };
      const event = { taskId: this.taskId, turnId: this.turnId, itemId: request.itemId };
      if (result)
        this.emit({
          ...event,
          type: "pending_request.resolved",
          payload: { request: { ...request, status: "resolved" } },
        });
      else
        this.emit({
          ...event,
          type: "pending_request.expired",
          payload: { request: { ...request, status: "expired" } },
        });
      deferred.resolve(result ?? { action: "cancel" });
      return settled;
    };
    const cancel = () => {
      if (this.#entries.has(requestId)) finish();
    };
    this.#entries.set(requestId, { request, promise: deferred.promise, finish });
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
    const entry = this.#entries.get(input.requestId);
    if (!entry)
      throw new PendingRequestResolutionError("not_found", "MCP request is no longer pending");
    const { request } = entry;
    if (
      input.type !== "mcp_elicitation" ||
      input.projectId !== request.projectId ||
      input.taskId !== request.taskId ||
      input.turnId !== request.turnId ||
      input.itemId !== request.itemId
    )
      throw new PendingRequestResolutionError("mismatch", "MCP request identity mismatch");
    const { action, content } = input.resolution;
    if (action === "accept" && !mcpElicitationContentMatchesRequest(request, content))
      throw new PendingRequestResolutionError(
        "mismatch",
        "MCP response does not match requested schema",
      );
    // URL 确认及拒绝/取消无需 content；协议中的 null 不传入官方 SDK。
    return entry.finish(
      action === "accept" && request.mode === "form"
        ? { action, content: { ...content } }
        : { action },
    );
  }

  close(): void {
    for (const entry of this.#entries.values()) entry.finish();
  }
}
