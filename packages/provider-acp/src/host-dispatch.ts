import type { AcpQueue } from "./queue.js";
import type { AcpTaskSubscriptions } from "./task-subscriptions.js";
import type { AgentTaskScope } from "@codexly/core";
import { join } from "node:path";
import { HistoricalTaskAttachments, exportTaskAttachment } from "@codexly/core/task-attachments";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ApplicationGenerationRequestSchema } from "@codexly/protocol/application-generation";
import { ApplicationPreferencesSchema } from "@codexly/protocol/application-preferences";
import {
  AcpConfigValuesSchema,
  AcpAuthCredentialsSchema,
  AcpConfigPreviewRequestSchema,
  AgentEngineSchema,
  AcpDefaultsRequestSchema,
  AcpSessionConfigRequestSchema,
  AcpProviderConfigSchema,
  AgentTurnOptionsSchema,
  AgentImageMediaTypeSchema,
  AgentSkillReferenceSchema,
  ResolvePendingRequestRequestSchema,
  ReorderAgentQueuedSubmissionsRequestSchema,
  PinAgentTaskRequestSchema,
  RenameAgentTaskRequestSchema,
  SearchOccurrencesQuerySchema,
} from "@codexly/protocol";
import {
  readTaskWithCheckpoint,
  generateApplicationText,
  AgentTurnNotSubmittedError,
  type AgentProvider,
  type AgentProviderTaskSnapshot,
} from "@codexly/core";
import type { AcpRuntime } from "./runtime.js";
export const ACP_HOST_RESPONSE_SENT = Symbol("acpHostResponseSent");

const Scope = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal("project"), Type.Literal("temporary")]),
    rootPath: Type.String({ minLength: 1 }),
    runtimeWorkspaceRoots: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 32 }),
  },
  { additionalProperties: false },
);
const ApplicationGeneration = Type.Object(
  { preferences: ApplicationPreferencesSchema, request: ApplicationGenerationRequestSchema },
  { additionalProperties: false },
);

const Input = Type.Object(
  {
    text: Type.String(),
    skills: Type.Array(AgentSkillReferenceSchema),
    files: Type.Array(
      Type.Object({ path: Type.String(), name: Type.String(), mediaType: Type.String() }),
    ),
    images: Type.Array(
      Type.Object({
        path: Type.String(),
        mediaType: AgentImageMediaTypeSchema,
        detail: Type.Union([
          Type.Literal("auto"),
          Type.Literal("high"),
          Type.Literal("low"),
          Type.Literal("original"),
        ]),
      }),
    ),
    textAttachments: Type.Array(Type.Object({ name: Type.String(), text: Type.String() })),
  },
  { additionalProperties: false },
);
export function hostRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid host object");
  return value as Record<string, unknown>;
}
function text(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value) throw new Error("Invalid host string");
  return value;
}
/** 方法白名单保持在应用交付层；禁止把 IPC 方法名映射为任意对象成员调用。 */
export async function dispatchAcpHost(
  runtime: AcpRuntime,
  message: Record<string, unknown>,
  subscribe: (provider: AgentProvider, scope: AgentTaskScope) => void,
  signal: AbortSignal,
  sendSnapshot: (snapshot: AgentProviderTaskSnapshot, projectId: string) => void,
  queue: AcpQueue,
  subscriptions?: AcpTaskSubscriptions,
): Promise<unknown> {
  const params = hostRecord(message["params"] ?? {}),
    method = text(message, "method");
  if (method === "application.generate") {
    if (!Value.Check(Scope, message["scope"]) || !Value.Check(ApplicationGeneration, params))
      throw new Error("Invalid application generation parameters");
    // 独立辅助会话不进入任务订阅和目录；工作目录只消费原生已授权的 scope。
    return generateApplicationText(
      params.preferences,
      message["scope"].rootPath,
      params.request,
      signal,
      (engine, cwd, prompt, model, stop) => runtime.generateText(engine, cwd, prompt, model, stop),
    );
  }
  if (
    method.startsWith("agent.") ||
    method.startsWith("settings.") ||
    method.startsWith("providers.") ||
    method === "catalog.import"
  ) {
    if (!Value.Check(AgentEngineSchema, params["engine"])) throw new Error("Invalid engine");
    const engine = params["engine"],
      service = runtime.agents[engine];
    switch (method) {
      case "agent.inspect":
        return service.inspect();
      case "agent.authenticate": {
        const credentials = params["credentials"];
        if (credentials !== undefined && !Value.Check(AcpAuthCredentialsSchema, credentials))
          throw new Error("Invalid authentication credentials");
        return service.authenticate(text(params, "methodId"), signal, credentials);
      }
      case "settings.preview": {
        if (Object.keys(params).some((key) => !["engine", "values", "change"].includes(key)))
          throw new Error("Invalid preview parameters");
        if (!Value.Check(Scope, message["scope"])) throw new Error("Invalid preview scope");
        const input = {
          values: params["values"],
          ...(params["change"] === undefined ? {} : { change: params["change"] }),
        };
        if (!Value.Check(AcpConfigPreviewRequestSchema, input))
          throw new Error("Invalid preview input");
        signal.throwIfAborted();
        return service.previewConfig(message["scope"].rootPath, input, signal);
      }
      case "settings.read":
        return service.readDefaults();
      case "settings.write": {
        const input = { values: params["values"] };
        if (!Value.Check(AcpDefaultsRequestSchema, input)) throw new Error("Invalid defaults");
        return service.updateDefaults(input.values);
      }
      case "settings.config.write": {
        const input = { configId: params["configId"], value: params["value"] };
        if (!Value.Check(AcpSessionConfigRequestSchema, input))
          throw new Error("Invalid default config");
        return service.setDefaultConfig(input.configId, input.value);
      }
      case "providers.list":
        return service.providers.list();
      case "providers.set":
        if (!Value.Check(AcpProviderConfigSchema, params["config"]))
          throw new Error("Invalid provider");
        return service.providers.configure(params["config"]);
      case "providers.disable":
        return service.providers.disable(text(params, "providerId"));
      case "catalog.import":
        return runtime.importCatalog(engine, signal);
      default:
        throw new Error("Unknown ACP host method");
    }
  }
  if (!Value.Check(Scope, message["scope"])) throw new Error("Invalid host scope");
  if (method === "attachment.export") {
    const id = text(params, "taskId"),
      scope = message["scope"];
    const task = await runtime.store.catalog("task.read", { id });
    if (!task || task.projectId !== (scope.kind === "temporary" ? null : scope.id))
      throw new Error("Task not found");
    // 附件导出不建立项目运行时，避免工作树任务 cwd 与已打开项目根产生作用域冲突。
    return exportTaskAttachment(
      new HistoricalTaskAttachments(join(runtime.directory, "history", "task-attachments")),
      id,
      text(params, "attachmentId"),
    );
  }
  if (method === "search.occurrences") {
    if (
      !Value.Check(SearchOccurrencesQuerySchema, params["input"]) ||
      (params["limit"] !== 1 && params["limit"] !== 30) ||
      Object.keys(params).some((key) => !["taskId", "input", "limit"].includes(key))
    )
      throw new Error("Invalid ACP search input");
    const scope = message["scope"];
    // 搜索只返回有界摘要；由共享目录核对任务归属，不创建项目订阅或改变当前项目根。
    return runtime.search.searchTaskOccurrences(
      text(params, "taskId"),
      params["input"],
      scope,
      signal,
      params["limit"],
    );
  }
  const scope = message["scope"],
    provider = runtime.forScope(scope);
  subscribe(provider, scope);
  if (method === "task.start") {
    if (!Value.Check(AgentEngineSchema, params["engine"])) throw new Error("Invalid engine");
    return provider.startTask({ engine: params["engine"] });
  }
  const id = text(params, "taskId");
  switch (method) {
    case "task.retain":
    case "task.release": {
      const lease = text(params, "leaseId");
      if (
        !subscriptions ||
        lease.length > 128 ||
        !lease.trim() ||
        Object.keys(params).some((key) => key !== "taskId" && key !== "leaseId")
      )
        throw new Error("Invalid task subscription");
      return method === "task.retain"
        ? subscriptions.retain(provider, scope.id, id, lease)
        : subscriptions.release(scope.id, id, lease);
    }
    case "prompt.start":
      if (!Value.Check(Input, params["input"]) || Object.hasOwn(params, "options"))
        throw new Error("Invalid configured ACP prompt");
      signal.throwIfAborted();
      if (!provider.startConfiguredTurn)
        throw new AgentTurnNotSubmittedError("ACP 配置会话执行端口不可用");
      if (params["initialConfig"] !== undefined) {
        if (!Value.Check(AcpConfigValuesSchema, params["initialConfig"]))
          throw new Error("Invalid initial config");
        return provider.startConfiguredTurn(id, params["input"], params["initialConfig"]);
      }
      return provider.startConfiguredTurn(id, params["input"]);
    case "queue.add": {
      if (!Value.Check(Input, params["input"])) throw new Error("Invalid queue input");
      const queuedSubmission = await queue.add(
        provider,
        scope.id,
        id,
        params["input"],
        text(params, "clientUserMessageId"),
      );
      await queue.resume(provider, scope.id, id).catch(() => {
        process.stderr.write("ACP_QUEUE_DISPATCH_FAILED\n");
      });
      return { queuedSubmission, queue: { data: await queue.list(provider, scope.id, id) } };
    }
    case "queue.list":
      return { data: await queue.list(provider, scope.id, id) };
    case "queue.update": {
      if (
        !Value.Check(Input, params["input"]) ||
        (params["status"] !== "queued" && params["status"] !== "editing")
      )
        throw new Error("Invalid queue update");
      const queuedSubmission = await queue.update(
        provider,
        scope.id,
        id,
        text(params, "queuedSubmissionId"),
        params["input"],
        params["status"],
      );
      return { queuedSubmission, queue: { data: await queue.list(provider, scope.id, id) } };
    }
    case "queue.reorder": {
      const input = { queuedSubmissionIds: params["queuedSubmissionIds"] };
      if (!Value.Check(ReorderAgentQueuedSubmissionsRequestSchema, input))
        throw new Error("Invalid queue order");
      await queue.reorder(provider, scope.id, id, input.queuedSubmissionIds);
      return { status: "reordered", queue: { data: await queue.list(provider, scope.id, id) } };
    }
    case "queue.start": {
      const turn = await queue.start(
        provider,
        scope.id,
        id,
        typeof params["queuedSubmissionId"] === "string" ? params["queuedSubmissionId"] : undefined,
      );
      return {
        taskId: id,
        turn,
        queue: { data: await queue.list(provider, scope.id, id) },
      };
    }
    case "queue.delete": {
      const deleted = await queue.delete(
        provider,
        scope.id,
        id,
        text(params, "queuedSubmissionId"),
      );
      return {
        deleted,
        queue: { data: await queue.list(provider, scope.id, id) },
      };
    }
    case "queue.move": {
      const offset = params["offset"];
      if (offset !== -1 && offset !== 1) throw new Error("Invalid queue move");
      return {
        moved: await queue.move(provider, scope.id, id, text(params, "queuedSubmissionId"), offset),
        queue: { data: await queue.list(provider, scope.id, id) },
      };
    }
    case "request.resolve": {
      const { requestId, ...input } = params;
      if (
        typeof requestId !== "string" ||
        !requestId ||
        !Value.Check(ResolvePendingRequestRequestSchema, input) ||
        input.projectId !== scope.id
      )
        throw new Error("Invalid approval resolution");
      // 原始 optionId 与完整身份交给共享权限代理校验，不在桌面推断授权范围。
      signal.throwIfAborted();
      return provider.resolvePendingRequest({ ...input, requestId });
    }
    case "turn.start":
      if (
        !Value.Check(Input, params["input"]) ||
        !Value.Check(AgentTurnOptionsSchema, params["options"])
      )
        throw new Error("Invalid turn input");
      signal.throwIfAborted();
      return provider.startTurn(id, params["input"], params["options"]);
    case "task.read": {
      const result = await readTaskWithCheckpoint(
        provider,
        id,
        {
          signal,
          ...(typeof params["cursor"] === "string" ? { cursor: params["cursor"] } : {}),
          ...(typeof params["summary"] === "boolean" ? { summary: params["summary"] } : {}),
        },
        (snapshot) => {
          // 响应与事件进入同一个 stdout 顺序队列，原生侧才能捕获准确的事件序号。
          sendSnapshot(snapshot, scope.id);
        },
      );
      return result === undefined ? undefined : ACP_HOST_RESPONSE_SENT;
    }
    case "task.pin": {
      const { taskId: _task, ...input } = params;
      if (!Value.Check(PinAgentTaskRequestSchema, input)) throw new Error("Invalid task pin");
      return provider.pinTask(id, input.pinned);
    }
    case "task.rename": {
      const { taskId: _task, ...input } = params;
      if (!Value.Check(RenameAgentTaskRequestSchema, input)) throw new Error("Invalid task title");
      return provider.renameTask(id, input.title);
    }
    case "task.archive":
      if (Object.keys(params).some((key) => key !== "taskId"))
        throw new Error("Invalid task archive");
      return provider.archiveTask(id);
    case "task.unarchive":
      if (Object.keys(params).some((key) => key !== "taskId"))
        throw new Error("Invalid task unarchive");
      return provider.unarchiveTask(id);
    case "task.delete":
      if (Object.keys(params).some((key) => key !== "taskId"))
        throw new Error("Invalid task delete");
      return provider.deleteTask(id);
    case "session.config.read":
      return provider.readSessionConfiguration?.(id);
    case "session.state.read":
      if (!provider.readSessionState) throw new Error("Unsupported ACP session state");
      signal.throwIfAborted();
      return provider.readSessionState(id);
    case "session.config.write": {
      const value = params["value"];
      if (typeof value !== "boolean" && typeof value !== "string")
        throw new Error("Invalid config value");
      if (!provider.setSessionConfiguration) throw new Error("Unsupported session config");
      return provider.setSessionConfiguration(id, text(params, "configId"), value);
    }
    case "turn.interrupt":
      return provider.interruptTurn(id, text(params, "turnId"));
    default:
      throw new Error("Unknown ACP host method");
  }
}
