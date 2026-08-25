import type { Project } from "@codexly/protocol";
import {
  CodexAgentProvider,
  type CodexProviderLogger,
  type CodexRpcClient,
} from "./agent-provider.js";
import type { RpcRequestId } from "./jsonl-rpc-client.js";

// 集中维护 Codex RPC mock 与协议测试基线数据。
export class FakeRpcClient {
  readonly calls: Readonly<{ method: string; params: unknown }>[] = [];
  readonly notifications: Readonly<{ method: string; params: unknown }>[] = [];
  readonly serverErrors: Readonly<{
    error: { code: number; data: unknown; message: string };
    id: RpcRequestId;
  }>[] = [];
  readonly serverResponses: Readonly<{ id: RpcRequestId; result: unknown }>[] = [];
  readonly #notificationListeners = new Set<
    (notification: { method: string; params: unknown }) => void
  >();
  readonly #threadTurns = new Map<string, unknown[]>();
  readonly #serverRequestListeners = new Set<
    (request: { id: RpcRequestId; method: string; params: unknown }) => void
  >();
  readonly #responses: unknown[];
  readonly #serverResponseBehavior: Promise<void> | (() => Promise<void>) | undefined;

  public constructor(
    responses: unknown[],
    serverResponseBehavior?: Promise<void> | (() => Promise<void>),
  ) {
    this.#responses = [...responses];
    this.#serverResponseBehavior = serverResponseBehavior;
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    const requestParams =
      params !== null && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const queuedResponse = this.#responses[0];
    if (
      method === "thread/goal/get" &&
      !(queuedResponse !== null && typeof queuedResponse === "object" && "goal" in queuedResponse)
    ) {
      return Promise.resolve({ goal: null });
    }
    if (method === "thread/turns/list") {
      const explicitPage =
        queuedResponse !== null &&
        typeof queuedResponse === "object" &&
        "backwardsCursor" in queuedResponse;
      const threadId = requestParams["threadId"];
      if (!explicitPage && typeof threadId === "string" && this.#threadTurns.has(threadId)) {
        const turns = this.#threadTurns.get(threadId) ?? [];
        return Promise.resolve({
          backwardsCursor: null,
          data: [...turns].reverse(),
          nextCursor: null,
        });
      }
    }
    const response = this.#responses.shift();
    const resolved = typeof response === "function" ? (response as () => unknown)() : response;
    if (
      method === "thread/read" &&
      requestParams["includeTurns"] === false &&
      resolved !== null &&
      typeof resolved === "object" &&
      "thread" in resolved
    ) {
      const result = resolved;
      if (result.thread !== null && typeof result.thread === "object") {
        const thread = result.thread as Record<string, unknown>;
        if (typeof thread["id"] === "string" && Array.isArray(thread["turns"])) {
          this.#threadTurns.set(thread["id"], thread["turns"]);
          return Promise.resolve({ ...result, thread: { ...thread, turns: [] } });
        }
      }
    }
    return resolved instanceof Error ? Promise.reject(resolved) : Promise.resolve(resolved);
  }

  public notify(method: string, params?: unknown): void {
    this.notifications.push({ method, params });
  }

  public onNotification(
    listener: (notification: { method: string; params: unknown }) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  public get notificationListenerCount(): number {
    return this.#notificationListeners.size;
  }

  public emitNotification(method: string, params?: unknown): void {
    for (const listener of this.#notificationListeners) {
      listener({ method, params });
    }
  }

  public onServerRequest(
    listener: (request: { id: RpcRequestId; method: string; params: unknown }) => void,
  ): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  public get serverRequestListenerCount(): number {
    return this.#serverRequestListeners.size;
  }

  public async respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> {
    this.serverResponses.push({ id, result });
    await (typeof this.#serverResponseBehavior === "function"
      ? this.#serverResponseBehavior()
      : this.#serverResponseBehavior);
  }

  public rejectServerRequest(
    id: RpcRequestId,
    error: { code: number; data: unknown; message: string },
  ): Promise<void> {
    this.serverErrors.push({ error, id });
    return Promise.resolve();
  }

  public emitServerRequest(id: RpcRequestId, method: string, params: unknown): void {
    for (const listener of this.#serverRequestListeners) {
      listener({ id, method, params });
    }
  }
}

export const projectRootPath = "/workspace/Codexly";

export const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "codexly",
  kind: "project",
  name: "Codexly",
  roots: [{ id: "root-codexly", path: projectRootPath }],
} as const;

export const projectTaskScope = {
  id: project.id,
  kind: "project",
  rootPath: projectRootPath,
  runtimeWorkspaceRoots: [projectRootPath],
} as const;

export const PINNED_THREAD_SECTION = {
  appearance: null,
  id: "01984de2-8f74-7c91-a3b2-5c5e937cf318",
  name: "Pinned",
} as const;

export function createCodexAgentProvider(options: {
  client: CodexRpcClient;
  logger?: CodexProviderLogger;
  project: Project;
}): CodexAgentProvider {
  return new CodexAgentProvider(
    options.client,
    {
      id: options.project.id,
      kind: "project",
      rootPath: options.project.roots[0]?.path ?? "",
      runtimeWorkspaceRoots: options.project.roots.map((root) => root.path),
    },
    {
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    },
  );
}

export function nativeThread(overrides: Record<string, unknown> = {}) {
  return {
    cliVersion: "0.149.0",
    createdAt: 1_753_228_800,
    cwd: "/workspace/Codexly",
    ephemeral: false,
    historyMode: "legacy",
    id: "task-1",
    modelProvider: "openai",
    name: null,
    preview: "实现真实 Task 历史\n更多内容",
    projectId: project.id,
    section: null,
    sectionEnteredAt: null,
    sessionId: "native-session",
    source: "cli",
    status: { type: "notLoaded" },
    turns: [],
    updatedAt: 1_753_232_400,
    ...overrides,
  };
}
