import {
  AccessStatusResponseSchema,
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentModelPageSchema,
  AgentMutationErrorSchema,
  AgentProviderConnectionMutationResponseSchema,
  AgentProviderConnectionStatusSchema,
  AppInfoResponseSchema,
  AppUpdateProgressResponseSchema,
  HealthResponseSchema,
  InstallAppUpdateResponseSchema,
  ConfigureCustomProviderResponseSchema,
  StartOfficialProviderLoginResponseSchema,
  WorkbenchPetCatalogResponseSchema,
  WorkbenchPetDownloadResponseSchema,
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SCOPE_ID,
  type AccessStatusResponse,
  type AgentAttachmentKind,
  type AgentCapabilities,
  type AgentGlobalSettings,
  type AgentGlobalSettingsResponse,
  type AgentModelPage,
  type AgentMutationError,
  type AgentProviderConnectionMutationResponse,
  type AgentProviderConnectionStatus,
  type AppInfoResponse,
  type AppUpdateProgressResponse,
  type HealthResponse,
  type InstallAppUpdateResponse,
  type ConfigureCustomProviderRequest,
  type ConfigureCustomProviderResponse,
  type PendingRequest,
  type ResolvePendingRequestRequest,
  type StartOfficialProviderLoginResponse,
  type WorkbenchPetCatalogResponse,
  type WorkbenchPetDownloadResponse,
} from "@codexly/protocol";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { v4 as createUuid } from "uuid";

import {
  startAgentEventSubscription,
  type SubscribeAgentEventsOptions,
  type WebSocketFactory,
} from "./event-client.js";

const APP_UPDATE_REQUEST_TIMEOUT_MS = 150_000;

export interface CodexlyClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  requestTimeouts?: Partial<CodexlyRequestTimeouts>;
  webSocketFactory?: WebSocketFactory;
}

export type CodexlyRequestTimeouts = Readonly<{
  mutationMs: number;
  queryMs: number;
  readMs: number;
}>;

export type ReadOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type ReadTaskOptions = ReadOptions & Readonly<{ cursor?: string }>;

export type AgentAttachmentUploadInput = Readonly<{
  content: Blob;
  kind: AgentAttachmentKind;
  name: string;
}>;

export type ListTasksOptions = Readonly<{
  archived?: true;
  completed?: true;
  cursor?: string;
  limit?: number;
  pinned?: true;
  searchTerm?: string;
}>;

export type MutationOptions = Readonly<{
  idempotencyKey?: string;
  signal?: AbortSignal;
}>;

export type UnauthorizedListener = () => void;

export type PendingRequestResolution<T extends PendingRequest> = Extract<
  ResolvePendingRequestRequest,
  { type: T["type"] }
>["resolution"];

export class CodexlyHttpError extends Error {
  public readonly status: number;

  public constructor(status: number, statusText: string, message?: string) {
    super(message ?? `Codexly request failed with ${String(status)} ${statusText}`.trim());
    this.name = "CodexlyHttpError";
    this.status = status;
  }
}

export class CodexlyMutationError extends CodexlyHttpError {
  public readonly code: AgentMutationError["code"];
  public readonly retryable: boolean;

  public constructor(status: number, statusText: string, error: AgentMutationError) {
    super(status, statusText, error.message);
    this.name = "CodexlyMutationError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export class CodexlyResponseError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexlyResponseError";
  }
}

export function appendQuery(
  path: string,
  values: Readonly<Record<string, boolean | string | number | undefined>>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function projectPath(projectId: string): string {
  if (projectId === TEMPORARY_TASK_SCOPE_ID) {
    return TEMPORARY_TASK_API_PATH;
  }
  return `/v1/projects/${encodeURIComponent(projectId)}`;
}

export function taskPath(projectId: string, taskId: string): string {
  return `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}`;
}

export function buildTaskAttachmentUrl(
  baseUrl: string,
  projectId: string,
  taskId: string,
  attachmentId: string,
): string {
  return `${baseUrl.replace(/\/$/u, "")}${taskPath(projectId, taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function buildProjectImageFileUrl(
  baseUrl: string,
  projectId: string,
  path: string,
  rootPath?: string,
): string {
  const requestPath = appendQuery(`${projectPath(projectId)}/files/image`, { path, rootPath });
  return `${baseUrl.replace(/\/$/u, "")}${requestPath}`;
}

export function buildProjectAttachmentUrl(
  baseUrl: string,
  projectId: string,
  attachmentId: string,
): string {
  return `${baseUrl.replace(/\/$/u, "")}${projectPath(projectId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function buildWorkbenchPetAssetUrl(assetId: string, baseUrl = ""): string {
  return `${baseUrl.replace(/\/$/u, "")}/v1/pets/assets/${encodeURIComponent(assetId)}`;
}

export class CodexlyTransport {
  protected readonly baseUrl: string;
  protected readonly fetchImplementation: typeof globalThis.fetch;
  protected readonly requestTimeouts: CodexlyRequestTimeouts;
  protected readonly webSocketFactory: WebSocketFactory;
  protected readonly unauthorizedListeners = new Set<UnauthorizedListener>();

  public constructor(options: CodexlyClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/u, "") ?? "";
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeouts = {
      mutationMs: options.requestTimeouts?.mutationMs ?? 60_000,
      queryMs: options.requestTimeouts?.queryMs ?? 30_000,
      readMs: options.requestTimeouts?.readMs ?? 15_000,
    };
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public async getHealth(options: ReadOptions = {}): Promise<HealthResponse> {
    return this.read("/v1/health", HealthResponseSchema, options);
  }

  public async getAppInfo(options: ReadOptions = {}): Promise<AppInfoResponse> {
    return this.read("/v1/app-info", AppInfoResponseSchema, options);
  }

  public async getAppUpdateProgress(options: ReadOptions = {}): Promise<AppUpdateProgressResponse> {
    return this.read("/v1/app-update/progress", AppUpdateProgressResponseSchema, options);
  }

  public async installAppUpdate(
    version: string,
    options: MutationOptions = {},
  ): Promise<InstallAppUpdateResponse> {
    return this.mutation(
      "/v1/app-update",
      { version },
      InstallAppUpdateResponseSchema,
      options,
      "POST",
      APP_UPDATE_REQUEST_TIMEOUT_MS,
    );
  }

  public async getAccessStatus(options: ReadOptions = {}): Promise<AccessStatusResponse> {
    return this.read("/v1/access", AccessStatusResponseSchema, options);
  }

  public async pairAccess(code: string): Promise<AccessStatusResponse> {
    return this.request(
      "/v1/access/pair",
      AccessStatusResponseSchema,
      {
        body: JSON.stringify({ code }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      AgentMutationErrorSchema,
      { timeoutMs: this.requestTimeouts.mutationMs },
    );
  }

  public async logoutAccess(): Promise<AccessStatusResponse> {
    return this.request(
      "/v1/access/logout",
      AccessStatusResponseSchema,
      { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
      AgentMutationErrorSchema,
      { timeoutMs: this.requestTimeouts.mutationMs },
    );
  }

  public subscribeUnauthorized(listener: UnauthorizedListener): () => void {
    this.unauthorizedListeners.add(listener);
    return () => this.unauthorizedListeners.delete(listener);
  }

  public async getCapabilities(options: ReadOptions = {}): Promise<AgentCapabilities> {
    return this.read("/v1/capabilities", AgentCapabilitiesSchema, options);
  }

  public async listModels(options: ReadOptions = {}): Promise<AgentModelPage> {
    return this.read("/v1/models", AgentModelPageSchema, options);
  }

  public async getProviderConnection(
    options: ReadOptions = {},
  ): Promise<AgentProviderConnectionStatus> {
    return this.read("/v1/provider-connection", AgentProviderConnectionStatusSchema, options);
  }

  public async startOfficialProviderLogin(
    options: MutationOptions = {},
  ): Promise<StartOfficialProviderLoginResponse> {
    return this.mutation(
      "/v1/provider-connection/official-login",
      {},
      StartOfficialProviderLoginResponseSchema,
      options,
    );
  }

  public async cancelProviderLogin(
    loginId: string,
    options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.mutation(
      "/v1/provider-connection/official-login/cancel",
      { loginId },
      AgentProviderConnectionMutationResponseSchema,
      options,
    );
  }

  public async configureCustomProvider(
    input: ConfigureCustomProviderRequest,
    options: MutationOptions = {},
  ): Promise<ConfigureCustomProviderResponse> {
    return this.mutation(
      "/v1/provider-connection/custom",
      input,
      ConfigureCustomProviderResponseSchema,
      options,
      "PUT",
    );
  }

  public async logoutProvider(
    options: MutationOptions = {},
  ): Promise<AgentProviderConnectionMutationResponse> {
    return this.mutation(
      "/v1/provider-connection/logout",
      {},
      AgentProviderConnectionMutationResponseSchema,
      options,
    );
  }

  public async getGlobalSettings(options: ReadOptions = {}): Promise<AgentGlobalSettingsResponse> {
    return this.read("/v1/settings", AgentGlobalSettingsResponseSchema, options);
  }

  public async listWorkbenchPets(options: ReadOptions = {}): Promise<WorkbenchPetCatalogResponse> {
    return this.read("/v1/pets", WorkbenchPetCatalogResponseSchema, options);
  }

  public async downloadWorkbenchPet(
    petId: string,
    options: MutationOptions = {},
  ): Promise<WorkbenchPetDownloadResponse> {
    return this.mutation(
      "/v1/pets/downloads",
      { petId },
      WorkbenchPetDownloadResponseSchema,
      options,
    );
  }

  public async updateGlobalSettings(
    settings: AgentGlobalSettings,
    options: MutationOptions = {},
  ): Promise<AgentGlobalSettingsResponse> {
    return this.mutation(
      "/v1/settings",
      settings,
      AgentGlobalSettingsResponseSchema,
      options,
      "PUT",
    );
  }

  public subscribeEvents(options: SubscribeAgentEventsOptions): () => void {
    return startAgentEventSubscription({
      ...options,
      baseUrl: this.baseUrl,
      webSocketFactory: this.webSocketFactory,
    });
  }

  protected mutation<T extends TSchema>(
    path: string,
    body: unknown,
    schema: T,
    options: MutationOptions,
    method: "DELETE" | "PATCH" | "POST" | "PUT" = "POST",
    timeoutMs = this.requestTimeouts.mutationMs,
  ): Promise<Static<T>> {
    return this.request(
      path,
      schema,
      {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey ?? createUuid(),
        },
        method,
      },
      AgentMutationErrorSchema,
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs,
      },
    );
  }

  protected read<T extends TSchema>(
    path: string,
    schema: T,
    options: ReadOptions,
    errorSchema?: TSchema,
  ): Promise<Static<T>> {
    return this.request(path, schema, {}, errorSchema, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs:
        options.signal === undefined ? this.requestTimeouts.readMs : this.requestTimeouts.queryMs,
    });
  }

  protected async request<T extends TSchema>(
    path: string,
    schema: T,
    init: RequestInit = {},
    errorSchema?: TSchema,
    requestOptions: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
  ): Promise<Static<T>> {
    // Query 取消与本地截止时间必须共同生效，避免旧响应继续下载、校验并写入缓存。
    const timeoutSignal = AbortSignal.timeout(
      requestOptions.timeoutMs ?? this.requestTimeouts.readMs,
    );
    const signal =
      requestOptions.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([requestOptions.signal, timeoutSignal]);
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { accept: "application/json", ...(init.headers as Record<string, string>) },
      signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        // 认证失效先通知运行时卸载敏感状态，同时保留原请求错误语义。
        for (const listener of this.unauthorizedListeners) {
          try {
            listener();
          } catch {
            // 单个页面订阅者不得改变 HTTP 错误边界。
          }
        }
      }
      if (errorSchema !== undefined) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch (error) {
          throw new CodexlyResponseError("Codexly error response is not valid JSON", {
            cause: error,
          });
        }
        // Mutation 错误也必须通过 Protocol Schema 后才能进入页面状态。
        if (!Value.Check(errorSchema, errorBody)) {
          throw new CodexlyResponseError(
            "Codexly error response does not match the protocol schema",
          );
        }
        throw new CodexlyMutationError(
          response.status,
          response.statusText,
          errorBody as AgentMutationError,
        );
      }
      try {
        const errorBody: unknown = await response.json();
        if (
          typeof errorBody === "object" &&
          errorBody !== null &&
          "message" in errorBody &&
          typeof errorBody.message === "string" &&
          errorBody.message.length > 0
        ) {
          throw new CodexlyHttpError(response.status, response.statusText, errorBody.message);
        }
      } catch (error) {
        if (error instanceof CodexlyHttpError) throw error;
        // 无结构错误响应继续使用 HTTP 状态 fallback。
      }
      throw new CodexlyHttpError(response.status, response.statusText);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new CodexlyResponseError("Codexly response is not valid JSON", { cause: error });
    }
    // 只有通过 Protocol Schema 的 unknown 响应才能进入 React Query 与页面状态。
    if (!Value.Check(schema, body)) {
      throw new CodexlyResponseError("Codexly response does not match the protocol schema");
    }
    return body;
  }
}
