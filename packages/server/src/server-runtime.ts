import { Buffer } from "node:buffer";
import type {
  AgentProvider,
  AgentProviderEvent,
  AgentProviderConnectionRepository,
  AgentRuntimeProvider,
  PendingRequestResolutionError,
} from "@codexly/core";
import {
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
  type AgentAttachmentKind,
  type AgentModel,
  type AgentModelPage,
  type AgentSandboxMode,
  type AgentTask,
  type AgentTaskSettings,
  type AgentTurn,
  type GenerateCommitMessageRequest,
  type ProjectGitStatus,
} from "@codexly/protocol";
import { LogController, type FastifyReply, type FastifyRequest } from "fastify";
import type { GitCommitError } from "./git-commit.js";
import { originalErrorMessage } from "./error-message.js";
import { MutationHttpError } from "./routes/context.js";

export const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

type AgentModelSettings = Pick<AgentTaskSettings, "model" | "reasoningEffort" | "sandboxMode">;

export function maximumAttachmentBytes(kind: AgentAttachmentKind): number {
  if (kind === "image") {
    return MAX_AGENT_IMAGE_BYTES;
  }
  return kind === "text" ? MAX_AGENT_TEXT_BYTES : MAX_AGENT_FILE_BYTES;
}

function orderById<T extends Readonly<{ id: string }>>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

export function resolveProjectDefaults(
  models: readonly AgentModel[],
  requested?: Partial<AgentModelSettings>,
  fallbackSandboxMode: AgentSandboxMode = "workspace-write",
): AgentModelSettings {
  const orderedModels = orderById(models);
  const model =
    orderedModels.find((item) => item.id === requested?.model) ??
    orderedModels.find((item) => item.isDefault) ??
    orderedModels[0];
  if (model === undefined) {
    throw new MutationHttpError("PROVIDER_ERROR", "No Agent models are available", 502, true);
  }
  const orderedEfforts = orderById(model.supportedReasoningEfforts);
  const reasoningEffort =
    orderedEfforts.find((item) => item.id === requested?.reasoningEffort)?.id ??
    orderedEfforts.find((item) => item.id === model.defaultReasoningEffort)?.id ??
    orderedEfforts[0]?.id;
  if (reasoningEffort === undefined) {
    throw new MutationHttpError(
      "PROVIDER_ERROR",
      "The selected Agent model has no reasoning effort",
      502,
      true,
    );
  }
  return {
    model: model.id,
    reasoningEffort,
    sandboxMode: requested?.sandboxMode ?? fallbackSandboxMode,
  };
}

export function assertValidProjectDefaults(
  models: readonly AgentModel[],
  settings: AgentModelSettings,
): void {
  const effective = resolveProjectDefaults(models, settings);
  if (
    effective.model !== settings.model ||
    effective.reasoningEffort !== settings.reasoningEffort
  ) {
    throw new MutationHttpError(
      "INVALID_REQUEST",
      "Model and reasoning effort combination is invalid",
      400,
    );
  }
}

export function taskFromSnapshot(
  snapshot: Awaited<ReturnType<AgentProvider["readTask"]>> & object,
  overrides: Partial<Pick<AgentTask, "title">> = {},
): AgentTask {
  return {
    id: snapshot.id,
    pinned: snapshot.pinned,
    projectId: snapshot.projectId,
    title: overrides.title ?? snapshot.title,
    updatedAt: snapshot.updatedAt,
  };
}

type ModelCatalogCacheEntry = Readonly<{
  expiresAt: number;
  page: AgentModelPage;
}>;

export function createModelCatalogLoader(
  provider: Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">,
  repository: Pick<AgentProviderConnectionRepository, "readProviderConnection">,
): () => Promise<AgentModelPage> {
  return async () => {
    const [activeConnection, storedConnection] = await Promise.all([
      provider.readProviderConnection(),
      repository.readProviderConnection(),
    ]);
    if (
      activeConnection.mode !== "custom" ||
      storedConnection?.mode !== "custom" ||
      storedConnection.customBaseUrl !== activeConnection.customBaseUrl
    ) {
      return provider.listModels();
    }
    if (storedConnection.customModels === null) {
      throw new MutationHttpError(
        "PROVIDER_ERROR",
        "Custom provider model catalog is unavailable",
        502,
        true,
      );
    }
    return storedConnection.customModels;
  };
}

export class ModelCatalogCache {
  readonly #load: () => Promise<AgentModelPage>;
  readonly #maxBytes: number;
  readonly #ttlMs: number;
  #entry: ModelCatalogCacheEntry | undefined;
  #generation = 0;
  #inFlight: Promise<AgentModelPage> | undefined;

  public constructor(
    load: () => Promise<AgentModelPage>,
    options: Readonly<{ maxBytes: number; ttlMs: number }>,
  ) {
    this.#load = load;
    this.#maxBytes = options.maxBytes;
    this.#ttlMs = options.ttlMs;
  }

  public read(): Promise<AgentModelPage> {
    const entry = this.#entry;
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return Promise.resolve(entry.page);
    }
    this.#entry = undefined;
    if (this.#inFlight !== undefined) {
      return this.#inFlight;
    }

    const generation = this.#generation;
    const inFlight = this.#load()
      .then((page) => {
        // 仅驻留有界目录；超限响应仍正常返回，并继续共享本次 in-flight 请求。
        const size = Buffer.byteLength(JSON.stringify(page), "utf8");
        if (generation === this.#generation && size <= this.#maxBytes) {
          this.#entry = { expiresAt: Date.now() + this.#ttlMs, page };
        }
        return page;
      })
      .finally(() => {
        if (this.#inFlight === inFlight) {
          this.#inFlight = undefined;
        }
      });
    this.#inFlight = inFlight;
    return inFlight;
  }

  public clear(): void {
    // Runtime 关闭或 Provider 重建时提升代次，阻止旧请求回填缓存。
    this.#generation += 1;
    this.#entry = undefined;
    this.#inFlight = undefined;
  }
}

export const DEFAULT_IDEMPOTENCY_CACHE_SIZE = 1_000;
export const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_HANDLER_TIMEOUT_MS = 60_000;
export const DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES = 1 * 1_024 * 1_024;
export const DEFAULT_MODEL_CATALOG_CACHE_TTL_MS = 30_000;
const COMMIT_MESSAGE_TIMEOUT_MS = 55_000;
const COMMIT_MESSAGE_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    message: { maxLength: 10_000, minLength: 1, type: "string" },
  },
  required: ["message"],
  type: "object",
} as const;

export class CodexlyLogController extends LogController {
  public override incomingRequest(): void {
    // 正常请求不写终端日志，只保留服务端错误的完成上下文。
  }

  public override requestCompleted(
    error: Error | null,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const fields = {
      durationMs: reply.elapsedTime,
      ...(error ? { errorCode: error.name } : {}),
      method: request.method,
      requestId: request.id,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
    };
    if (reply.statusCode >= 500) {
      request.log.error(fields, "request completed");
    }
  }
}

function normalizeJsonForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonForFingerprint);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  // Mutation Body 已通过 JSON Schema；递归排序对象键以消除字段顺序差异。
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, normalizeJsonForFingerprint(item)]),
  );
}

export function fingerprintPayload(payload: unknown): string {
  return JSON.stringify(normalizeJsonForFingerprint(payload));
}

export function toPendingRequestHttpError(error: PendingRequestResolutionError): MutationHttpError {
  switch (error.code) {
    case "not_found":
      return new MutationHttpError("PENDING_REQUEST_NOT_FOUND", "Pending request not found", 404);
    case "expired":
      return new MutationHttpError("PENDING_REQUEST_EXPIRED", "Pending request expired", 409);
    case "resolved":
      return new MutationHttpError(
        "PENDING_REQUEST_ALREADY_RESOLVED",
        "Pending request already resolved",
        409,
      );
    case "mismatch":
      return new MutationHttpError(
        "PENDING_REQUEST_MISMATCH",
        "Pending request identity does not match",
        409,
      );
  }
}

export function assertCommitSelection(
  status: ProjectGitStatus,
  request: GenerateCommitMessageRequest,
): void {
  if (status.repositoryMode !== "root") {
    throw new MutationHttpError(
      "GIT_REPOSITORY_UNAVAILABLE",
      "Git commits require the project root to be a repository",
      409,
    );
  }
  if (status.snapshot !== request.expectedSnapshot) {
    throw new MutationHttpError(
      "GIT_STATUS_CHANGED",
      "Git changes changed before the request completed",
      409,
    );
  }
  const changedPaths = new Set([...status.staged, ...status.unstaged].map((change) => change.path));
  if (request.paths.some((path) => !changedPaths.has(path))) {
    throw new MutationHttpError(
      "GIT_PATH_UNAVAILABLE",
      "A selected file is no longer available",
      409,
    );
  }
}

function readGeneratedCommitMessage(turn: AgentTurn, completedAssistantText?: string): string {
  if (turn.status !== "completed") {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      turn.error ?? "Commit message generation did not complete",
      502,
      true,
    );
  }
  let assistantText = completedAssistantText;
  for (const item of [...turn.items].reverse()) {
    if (item.type === "message" && item.role === "assistant") {
      assistantText = item.text;
      break;
    }
  }
  if (assistantText === undefined) {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      "Codex returned no commit message",
      502,
      true,
    );
  }
  try {
    const parsed: unknown = JSON.parse(assistantText);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Object.keys(parsed).length !== 1 ||
      !("message" in parsed) ||
      typeof parsed.message !== "string" ||
      parsed.message.trim().length === 0 ||
      parsed.message.length > 10_000
    ) {
      throw new Error("Invalid structured output");
    }
    return parsed.message.trim();
  } catch {
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      "Codex returned an invalid commit message",
      502,
      true,
    );
  }
}

export async function generateCommitMessageWithCodex(
  provider: AgentProvider,
  prompt: string,
  settings: AgentTaskSettings,
): Promise<string> {
  const task = await provider.startTask({ ephemeral: true });
  const completedAssistantMessages = new Map<string, string>();
  let turnId: string | undefined;
  let turnFinished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  try {
    const completedTurn = new Promise<AgentTurn>((resolve, reject) => {
      unsubscribeEvents = provider.subscribeEvents(
        (event: AgentProviderEvent) => {
          if (event.taskId !== task.id) {
            return;
          }
          if (
            event.type === "item.completed" &&
            event.payload.item.type === "message" &&
            event.payload.item.role === "assistant"
          ) {
            // App Server 先交付最终 Message Item，终态 Turn 不保证重复携带完整 items。
            completedAssistantMessages.set(event.turnId, event.payload.item.text);
          } else if (event.type === "turn.completed") {
            turnFinished = true;
            resolve(event.payload.turn);
          } else if (event.type === "provider.error" && !event.payload.willRetry) {
            reject(new Error(event.payload.message));
          }
        },
        { includeEphemeral: true },
      );
      timeout = setTimeout(() => {
        reject(new Error("Commit message generation timed out"));
      }, COMMIT_MESSAGE_TIMEOUT_MS);
    });
    const startedTurn = await provider.startTurn(
      task.id,
      {
        files: [],
        images: [],
        outputSchema: COMMIT_MESSAGE_OUTPUT_SCHEMA,
        skills: [],
        text: prompt,
        textAttachments: [],
      },
      {
        ...settings,
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxMode: "read-only",
      },
    );
    turnId = startedTurn.id;
    if (startedTurn.status !== "running") {
      turnFinished = true;
      return readGeneratedCommitMessage(startedTurn);
    }
    const turn = await completedTurn;
    return readGeneratedCommitMessage(turn, completedAssistantMessages.get(turn.id));
  } catch (error) {
    if (error instanceof MutationHttpError) {
      throw error;
    }
    throw new MutationHttpError(
      "COMMIT_MESSAGE_GENERATION_FAILED",
      originalErrorMessage(error, "Codex could not generate a commit message"),
      502,
      true,
    );
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    unsubscribeEvents?.();
    if (!turnFinished && turnId !== undefined) {
      await provider.interruptTurn(task.id, turnId).catch(() => undefined);
    }
    // 临时 Task 不落盘，只需释放事件订阅和运行时所有权。
    await provider.unsubscribeTask(task.id).catch(() => undefined);
  }
}

export function toGitCommitHttpError(error: GitCommitError): MutationHttpError {
  const statusCode = error.code === "GIT_COMMIT_FAILED" ? 502 : 409;
  return new MutationHttpError(error.code, error.message, statusCode);
}
