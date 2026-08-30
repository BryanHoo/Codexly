import type {
  AgentCancellationSignal,
  AgentFileSearchInput,
  AgentFileSearchMatch,
  AgentFileSearchProvider,
} from "@codexly/core";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

const MAX_RESULTS = 50;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

interface SearchRequest {
  data: readonly AgentFileSearchMatch[];
  detachAbort: () => void;
  query: string;
  receivedUpdate: boolean;
  reject: (error: Error) => void;
  resolve: (page: Readonly<{ data: readonly AgentFileSearchMatch[] }>) => void;
  settled: boolean;
}

interface SearchSession {
  activeRequest?: SearchRequest;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastSnapshot?: Readonly<{
    data: readonly AgentFileSearchMatch[];
    query: string;
  }>;
  pendingRequest?: SearchRequest;
  projectId: string;
  roots: readonly string[];
  rootsKey: string;
  sessionId: string;
  startPromise: Promise<void>;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function validateInput(input: AgentFileSearchInput): void {
  if (input.projectId.length === 0 || input.sessionId.length === 0) {
    throw new TypeError("File search projectId and sessionId must not be empty");
  }
  if (input.roots.length === 0 || input.roots.some((root) => root.length === 0)) {
    throw new TypeError("File search roots must not be empty");
  }
}

function normalizeRelativePath(value: unknown): string {
  const path = expectString(value, "Codex fuzzy file search path").replaceAll("\\", "/");
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    segments.length > 20 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new CodexProtocolMappingError("Codex fuzzy file search path is invalid");
  }
  return path;
}

function mapFiles(value: unknown, roots: readonly string[]): readonly AgentFileSearchMatch[] {
  if (!Array.isArray(value)) {
    throw new CodexProtocolMappingError("Codex fuzzy file search files must be an array");
  }
  const rootSet = new Set(roots);
  const data: AgentFileSearchMatch[] = [];
  for (const item of value) {
    const file = expectRecord(item, "Codex fuzzy file search result");
    // Codex 0.151 的外层通知使用 camelCase，但 FuzzyFileSearchResult 字段保持 snake_case。
    if (file["match_type"] !== "file") continue;
    const rootPath = expectString(file["root"], "Codex fuzzy file search root");
    if (!rootSet.has(rootPath)) {
      throw new CodexProtocolMappingError("Codex fuzzy file search root is outside the session");
    }
    const name = expectString(file["file_name"], "Codex fuzzy file search file_name");
    if (name.length === 0) {
      throw new CodexProtocolMappingError("Codex fuzzy file search file_name must not be empty");
    }
    data.push({ name, path: normalizeRelativePath(file["path"]), rootPath });
    if (data.length === MAX_RESULTS) break;
  }
  return data;
}

export class CodexFuzzyFileSearchService implements AgentFileSearchProvider {
  readonly #client: CodexRpcClient;
  readonly #idleTimeoutMs: number;
  readonly #sessions = new Map<string, SearchSession>();

  public constructor(client: CodexRpcClient, options: Readonly<{ idleTimeoutMs?: number }> = {}) {
    this.#client = client;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  public receiveNotification(method: string, params: unknown): void {
    if (method === "fuzzyFileSearch/sessionUpdated") {
      this.#receiveUpdated(params);
    } else if (method === "fuzzyFileSearch/sessionCompleted") {
      this.#receiveCompleted(params);
    }
  }

  public async search(
    input: AgentFileSearchInput,
  ): Promise<Readonly<{ data: readonly AgentFileSearchMatch[] }>> {
    validateInput(input);
    const session = this.#getOrStartSession(input);
    try {
      await session.startPromise;
    } catch (error) {
      if (this.#sessions.get(input.sessionId) === session) {
        this.#sessions.delete(input.sessionId);
      }
      throw error;
    }
    if (input.signal?.aborted === true) {
      this.#scheduleIdleStop(session);
      throw abortError("File search request was aborted");
    }

    this.#clearIdleTimer(session);
    return new Promise((resolve, reject) => {
      const cachedSnapshot =
        session.lastSnapshot?.query === input.query ? session.lastSnapshot : undefined;
      const request: SearchRequest = {
        data: cachedSnapshot?.data ?? [],
        detachAbort: () => undefined,
        query: input.query,
        receivedUpdate: cachedSnapshot !== undefined,
        reject,
        resolve,
        settled: false,
      };
      request.detachAbort = this.#listenForAbort(session, request, input.signal);

      if (session.activeRequest === undefined) {
        this.#dispatchRequest(session, request);
        return;
      }

      // 0.151.0 的完成通知无法标识 query；等待 active 完成后才能发送最新 pending。
      this.#rejectRequest(session.activeRequest, abortError("File search query was replaced"));
      if (session.pendingRequest !== undefined) {
        this.#rejectRequest(session.pendingRequest, abortError("File search query was replaced"));
      }
      session.pendingRequest = request;
    });
  }

  public async stop(projectId: string, sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    if (session.projectId !== projectId) {
      throw new CodexProtocolMappingError("File search session belongs to another project");
    }
    this.#sessions.delete(sessionId);
    this.#clearIdleTimer(session);
    const activeRequest = session.activeRequest;
    const pendingRequest = session.pendingRequest;
    delete session.activeRequest;
    delete session.pendingRequest;
    if (activeRequest !== undefined) {
      this.#rejectRequest(activeRequest, abortError("File search session was stopped"));
    }
    if (pendingRequest !== undefined) {
      this.#rejectRequest(pendingRequest, abortError("File search session was stopped"));
    }
    try {
      await session.startPromise;
    } catch {
      return;
    }
    expectRecord(
      await this.#client.request("fuzzyFileSearch/sessionStop", { sessionId }),
      "fuzzyFileSearch/sessionStop response",
    );
  }

  public async releaseProject(projectId: string): Promise<void> {
    const sessionIds = [...this.#sessions.values()]
      .filter((session) => session.projectId === projectId)
      .map((session) => session.sessionId);
    await Promise.all(sessionIds.map((sessionId) => this.stop(projectId, sessionId)));
  }

  #getOrStartSession(input: AgentFileSearchInput): SearchSession {
    const roots = [...input.roots];
    const rootsKey = JSON.stringify(roots);
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined) {
      if (current.projectId !== input.projectId || current.rootsKey !== rootsKey) {
        throw new CodexProtocolMappingError(
          "File search session belongs to another project or root set",
        );
      }
      return current;
    }

    // App Server 在会话内只遍历一次，后续 query update 复用同一多线程索引。
    const startPromise = this.#client
      .request("fuzzyFileSearch/sessionStart", { roots, sessionId: input.sessionId })
      .then((response) => {
        expectRecord(response, "fuzzyFileSearch/sessionStart response");
      });
    const session: SearchSession = {
      projectId: input.projectId,
      roots,
      rootsKey,
      sessionId: input.sessionId,
      startPromise,
    };
    this.#sessions.set(input.sessionId, session);
    return session;
  }

  #listenForAbort(
    session: SearchSession,
    request: SearchRequest,
    signal: AgentCancellationSignal | undefined,
  ): () => void {
    if (signal === undefined) return () => undefined;
    const onAbort = () => {
      if (request.settled) return;
      if (session.pendingRequest === request) {
        delete session.pendingRequest;
      }
      this.#rejectRequest(request, abortError("File search request was aborted"));
      if (session.pendingRequest === undefined) this.#scheduleIdleStop(session);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => {
      signal.removeEventListener("abort", onAbort);
    };
  }

  #receiveUpdated(params: unknown): void {
    try {
      const notification = expectRecord(params, "fuzzyFileSearch/sessionUpdated notification");
      const sessionId = expectString(notification["sessionId"], "fuzzy file search sessionId");
      const session = this.#sessions.get(sessionId);
      if (session === undefined) return;
      const query = expectString(notification["query"], "fuzzy file search query");
      const data = mapFiles(notification["files"], session.roots);
      session.lastSnapshot = { data, query };
      if (session.activeRequest?.query !== query) return;
      session.activeRequest.data = data;
      session.activeRequest.receivedUpdate = true;
    } catch (error) {
      this.#rejectInvalidNotification(params, error);
    }
  }

  #receiveCompleted(params: unknown): void {
    try {
      const notification = expectRecord(params, "fuzzyFileSearch/sessionCompleted notification");
      const sessionId = expectString(notification["sessionId"], "fuzzy file search sessionId");
      const session = this.#sessions.get(sessionId);
      const activeRequest = session?.activeRequest;
      if (session === undefined || activeRequest?.receivedUpdate !== true) return;

      delete session.activeRequest;
      if (!activeRequest.settled) {
        activeRequest.settled = true;
        activeRequest.detachAbort();
        activeRequest.resolve({ data: activeRequest.data });
      }
      this.#dispatchPendingRequest(session);
    } catch (error) {
      this.#rejectInvalidNotification(params, error);
    }
  }

  #rejectInvalidNotification(params: unknown, error: unknown): void {
    if (params === null || typeof params !== "object" || Array.isArray(params)) return;
    const sessionId = (params as Record<string, unknown>)["sessionId"];
    if (typeof sessionId !== "string") return;
    const session = this.#sessions.get(sessionId);
    if (session === undefined) return;
    const request = session.activeRequest ?? session.pendingRequest;
    if (request !== undefined) {
      this.#rejectRequest(
        request,
        error instanceof Error
          ? error
          : new CodexProtocolMappingError("Invalid file search update"),
      );
    }
    this.#scheduleIdleStop(session);
  }

  #dispatchRequest(session: SearchSession, request: SearchRequest): void {
    session.activeRequest = request;
    void this.#client
      .request("fuzzyFileSearch/sessionUpdate", {
        query: request.query,
        sessionId: session.sessionId,
      })
      .then((response) => {
        expectRecord(response, "fuzzyFileSearch/sessionUpdate response");
      })
      .catch((error: unknown) => {
        if (
          this.#sessions.get(session.sessionId) !== session ||
          session.activeRequest !== request
        ) {
          return;
        }
        delete session.activeRequest;
        this.#rejectRequest(
          request,
          error instanceof Error ? error : new Error("File search update failed"),
        );
        this.#dispatchPendingRequest(session);
      });
  }

  #dispatchPendingRequest(session: SearchSession): void {
    const pendingRequest = session.pendingRequest;
    if (pendingRequest === undefined) {
      this.#scheduleIdleStop(session);
      return;
    }
    delete session.pendingRequest;
    this.#dispatchRequest(session, pendingRequest);
  }

  #rejectRequest(request: SearchRequest, error: Error): void {
    if (request.settled) return;
    request.settled = true;
    request.detachAbort();
    request.reject(error);
  }

  #clearIdleTimer(session: SearchSession): void {
    if (session.idleTimer === undefined) return;
    clearTimeout(session.idleTimer);
    delete session.idleTimer;
  }

  #scheduleIdleStop(session: SearchSession): void {
    this.#clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      void this.stop(session.projectId, session.sessionId).catch(() => undefined);
    }, this.#idleTimeoutMs);
    session.idleTimer.unref();
  }
}
