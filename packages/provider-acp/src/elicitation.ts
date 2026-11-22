import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
  RequestError,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
} from "@agentclientprotocol/sdk";
import {
  mapMcpElicitationFormFields,
  mcpElicitationContentMatchesRequest,
  PendingRequestResolutionError,
  type AgentProviderEventListener,
  type ResolvePendingRequestInput,
} from "@codexly/core";
import { parseElicitationUrl, type PendingRequest } from "@codexly/protocol";

type Request = Extract<PendingRequest, { type: "mcp_elicitation" }>;
type Resolution = Extract<ResolvePendingRequestInput, { type: "mcp_elicitation" }>;
type Pending = Request & { status: "pending" };
type Reply = CreateElicitationResponse;

const CANCEL: Reply = { action: "cancel" };
const MAX_REQUESTS = 64;

interface Waiting {
  request: Pending;
  reply: (response: Reply) => void;
  signal: AbortSignal;
  abort: () => void;
  patterns: ReadonlyMap<string, string>;
  urlId?: string;
}

function formSchema(value: unknown) {
  // SDK 已校验 wire 数据；这里将 v1 允许的省略字段归一化，再复用应用表单校验。
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw RequestError.invalidParams();
  const schema = value as {
    properties?: Record<string, { pattern?: unknown }> | null;
    required?: string[];
    title?: string;
    description?: string;
  };
  if (schema.properties === null) throw RequestError.invalidParams();
  const properties = schema.properties ?? {};
  if (Object.keys(properties).length > 128) throw RequestError.invalidParams();
  const fields = mapMcpElicitationFormFields({
    type: "object",
    properties,
    required: schema.required,
  });
  const patterns = new Map<string, string>();
  for (const [key, field] of Object.entries(properties)) {
    if (field.pattern == null) continue;
    if (typeof field.pattern !== "string" || field.pattern.length > 2048)
      throw RequestError.invalidParams();
    new RegExp(field.pattern, "u");
    patterns.set(key, field.pattern);
  }
  return {
    fields,
    patterns,
    ...(schema.title ? { formTitle: schema.title } : {}),
    ...(schema.description ? { formDescription: schema.description } : {}),
  };
}

function patternsMatch(
  patterns: ReadonlyMap<string, string>,
  content: NonNullable<Extract<Reply, { action: "accept" }>["content"]>,
): boolean {
  if (patterns.size === 0) return true;
  const checks = [];
  for (const [id, pattern] of patterns) {
    if (!Object.hasOwn(content, id)) continue;
    const value = content[id];
    if (typeof value !== "string") return false;
    checks.push({ pattern, value });
  }
  if (checks.length === 0) return true;
  try {
    // 所有来自 Agent 的正则共享一次提交的执行预算。
    return (
      runInNewContext(
        'checks.every(({ pattern, value }) => new RegExp(pattern, "u").test(value))',
        { checks },
        { timeout: 25 },
      ) === true
    );
  } catch {
    return false;
  }
}

/** ACP 请求只保留在所属连接和运行回合内，问卷答案直接返回 Agent。 */
export class AcpElicitations {
  readonly #waiting = new Map<string, Waiting>();
  readonly #pendingUrls = new Set<string>();
  readonly #opened = new Map<string, Extract<Request, { mode: "url" }>>();

  constructor(
    private readonly projectId: string,
    private readonly emit: AgentProviderEventListener,
  ) {}

  list(taskId: string): Pending[] {
    return [...this.#waiting.values()]
      .filter(({ request }) => request.taskId === taskId)
      .map(({ request }) => structuredClone(request));
  }

  request(
    taskId: string,
    turnId: string,
    agent: string,
    input: CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<Reply> {
    if (signal.aborted) return Promise.resolve(CANCEL);
    if (this.#waiting.size >= MAX_REQUESTS) throw RequestError.invalidParams();
    const requestId = randomUUID();
    const base = {
      requestId,
      projectId: this.projectId,
      taskId,
      turnId,
      itemId:
        "toolCallId" in input && typeof input.toolCallId === "string"
          ? `acp:tool:${input.toolCallId}`
          : `acp:elicitation:${requestId}`,
      type: "mcp_elicitation",
      acp: true,
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      message: input.message || " ",
      serverName: agent,
    } as const;
    let request: Pending;
    let patterns: ReadonlyMap<string, string> = new Map();
    let urlId: string | undefined;
    if (input.mode === "form") {
      try {
        const { patterns: parsedPatterns, ...form } = formSchema(input.requestedSchema);
        patterns = parsedPatterns;
        request = { ...base, mode: "form", ...form };
      } catch {
        throw RequestError.invalidParams(undefined, "Invalid elicitation form");
      }
    } else if (input.mode === "url") {
      const url = input.url;
      const id = input.elicitationId;
      if (
        typeof url !== "string" ||
        typeof id !== "string" ||
        this.#pendingUrls.has(id) ||
        this.#opened.has(id)
      )
        throw RequestError.invalidParams();
      if (!parseElicitationUrl(url)) throw RequestError.invalidParams();
      urlId = id;
      request = { ...base, mode: "url", url };
    } else {
      throw RequestError.invalidParams();
    }
    return new Promise((reply) => {
      const abort = () => {
        this.#settle(entry, CANCEL, "expired");
      };
      const entry: Waiting = {
        request,
        reply,
        signal,
        abort,
        patterns,
        ...(urlId === undefined ? {} : { urlId }),
      };
      this.#waiting.set(requestId, entry);
      if (urlId !== undefined) this.#pendingUrls.add(urlId);
      signal.addEventListener("abort", abort, { once: true });
      this.#publish("pending_request.created", request);
    });
  }

  resolve(input: Resolution): Request {
    const entry = this.#waiting.get(input.requestId);
    if (!entry) throw new PendingRequestResolutionError("not_found", "ACP 交互请求已结束");
    const request = entry.request;
    if (
      input.projectId !== request.projectId ||
      input.taskId !== request.taskId ||
      input.turnId !== request.turnId ||
      input.itemId !== request.itemId
    )
      throw new PendingRequestResolutionError("mismatch", "ACP 交互请求身份不匹配");
    const { resolution } = input;
    let reply: Reply = { action: resolution.action };
    if (resolution.action === "accept") {
      if (
        !mcpElicitationContentMatchesRequest(request, resolution.content) ||
        !patternsMatch(entry.patterns, resolution.content)
      )
        throw new PendingRequestResolutionError("mismatch", "回答不符合 ACP 问卷要求");
      if (request.mode === "form") reply = { action: "accept", content: resolution.content };
    }
    return this.#settle(entry, reply, "resolved");
  }

  complete(id: string): void {
    const request = this.#opened.get(id);
    if (!request) return;
    this.#opened.delete(id);
    this.#publish("pending_request.resolved", { ...request, externalStatus: "completed" });
  }

  finishTurn(taskId: string, turnId: string): void {
    for (const entry of this.#waiting.values()) {
      if (entry.request.taskId === taskId && entry.request.turnId === turnId)
        this.#settle(entry, CANCEL, "expired");
    }
  }

  clear(): void {
    for (const entry of this.#waiting.values()) this.#settle(entry, CANCEL, "expired");
    this.#pendingUrls.clear();
    this.#opened.clear();
  }

  #settle(entry: Waiting, reply: Reply, status: "resolved" | "expired"): Request {
    const id = entry.request.requestId;
    this.#waiting.delete(id);
    entry.signal.removeEventListener("abort", entry.abort);
    const request = { ...entry.request, status };
    if (entry.urlId !== undefined) this.#pendingUrls.delete(entry.urlId);
    // 外部流程可能在回合结束后完成；同一连接内只保留最近接受且尚未完成的 ID。
    if (request.mode === "url" && reply.action === "accept" && entry.urlId !== undefined) {
      request.externalStatus = "opened";
      this.#opened.set(entry.urlId, request);
      if (this.#opened.size > MAX_REQUESTS) {
        const oldest = this.#opened.keys().next().value;
        if (oldest !== undefined) this.#opened.delete(oldest);
      }
    }
    this.#publish(
      status === "resolved" ? "pending_request.resolved" : "pending_request.expired",
      request,
    );
    entry.reply(reply);
    return request;
  }

  #publish(
    type: "pending_request.created" | "pending_request.resolved" | "pending_request.expired",
    request: Request,
  ): void {
    const event = { taskId: request.taskId, turnId: request.turnId, itemId: request.itemId };
    // 事件联合类型根据状态缩窄，拒绝发出与待办状态不一致的事件。
    if (type === "pending_request.created" && request.status === "pending")
      this.emit({ ...event, type, payload: { request: { ...request, status: "pending" } } });
    else if (type === "pending_request.resolved" && request.status === "resolved")
      this.emit({ ...event, type, payload: { request: { ...request, status: "resolved" } } });
    else if (type === "pending_request.expired" && request.status === "expired")
      this.emit({ ...event, type, payload: { request: { ...request, status: "expired" } } });
  }
}
