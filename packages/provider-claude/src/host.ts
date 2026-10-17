import { exportClaudeAttachment } from "./attachment-export.js";
import { Value } from "@sinclair/typebox/value";
import { AgentTurnOptionsSchema, ReloadAgentMcpServersRequestSchema } from "@codexly/protocol";
import { resolve } from "node:path";
import {
  query,
  getSessionMessages,
  getSessionInfo,
  deleteSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentTaskScope, CatalogOperations, LocalCatalogStore } from "@codexly/core";
import { readTaskWithCheckpoint } from "@codexly/core";
import type { AgentProviderTurnInput, ResolvePendingRequestInput } from "@codexly/core";
import type { ClaudeSettings, ConfigureCustomProviderRequest } from "@codexly/protocol";
import { ClaudeRuntime } from "./runtime.js";
import { record } from "./sdk-values.js";
import { HostOutput } from "./host-output.js";

// 构建时从已安装 SDK 注入版本，应用下载清单与宿主始终使用同一依赖版本。
declare const CODEXLY_CLAUDE_SDK_VERSION: string;
const HOST_VERSION = `codexly-claude-host/1 sdk/${CODEXLY_CLAUDE_SDK_VERSION}`;
if (process.argv.includes("--version")) {
  process.stdout.write(`${HOST_VERSION}\n`);
} else {
  const directory = process.argv[2],
    executable = process.argv[3];
  if (!directory || !executable)
    throw new Error("Claude host requires private data and executable paths");
  // 保留用户 CLAUDE_CONFIG_DIR；SDK 配置、认证和会话历史与本机 CLI 共用。
  const catalogRequests = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  let nextCatalogId = 1;
  let closed = false;
  const close = (reason: string, failed = true) => {
    if (closed) return;
    closed = true;
    process.exitCode = failed ? 1 : 0;
    // 先登记硬退出兜底，后续 SDK 清理异常也不能留下常驻后台宿主。
    setTimeout(() => process.exit(failed ? 1 : 0), 1000).unref();
    output.close();
    // 只输出固定诊断码，不包含请求、SDK 消息、文件路径或认证信息。
    if (failed) process.stderr.write(`Claude host transport: ${reason}\n`);
    for (const request of catalogRequests.values()) request.reject(new Error("Claude host closed"));
    catalogRequests.clear();
    try {
      runtime.close();
    } finally {
      process.stdin.destroy();
    }
  };
  const output = new HostOutput(process.stdout, close);
  const send = (message: Record<string, unknown>) => output.send(message);
  const store: LocalCatalogStore = {
    async catalog<K extends keyof CatalogOperations>(
      operation: K,
      payload: CatalogOperations[K][0],
    ): Promise<CatalogOperations[K][1]> {
      if (closed) throw new Error("Claude host closed");
      if (catalogRequests.size >= 64) throw new Error("Catalog request capacity exceeded");
      const id = nextCatalogId++,
        deferred = Promise.withResolvers<unknown>();
      catalogRequests.set(id, deferred);
      const timeout = setTimeout(() => {
        deferred.reject(new Error("Catalog request timed out"));
      }, 30_000);
      try {
        if (!send({ catalogId: id, operation, payload }))
          deferred.reject(new Error("Claude host closed"));
        return (await deferred.promise) as CatalogOperations[K][1];
      } finally {
        clearTimeout(timeout);
        catalogRequests.delete(id);
      }
    },
  };
  const runtime = new ClaudeRuntime(resolve(directory), store, {
    getSessionMessages,
    getSessionInfo,
    deleteSession,
    query: (input) =>
      query({
        ...input,
        options: {
          ...input.options,
          pathToClaudeCodeExecutable: resolve(executable),
        },
      }),
  });
  const subscribed = new WeakSet<ReturnType<ClaudeRuntime["forScope"]>>();
  const snapshotResponseSent = Symbol("snapshotResponseSent");
  const execute = async (message: Record<string, unknown>) => {
    const params = record(message["params"]),
      method = message["method"];
    if (method === "profile")
      return runtime.inspect(message["scope"] as AgentTaskScope | undefined);
    if (method === "configure") return runtime.configure(params as ConfigureCustomProviderRequest);
    if (method === "settings.read") return runtime.readSettings();
    if (method === "settings.write") return runtime.writeSettings(params as ClaudeSettings);
    if (method === "disconnect") {
      return runtime.disconnect();
    }
    const scope = message["scope"] as AgentTaskScope | undefined;
    if (!scope?.id || !scope.rootPath || !["project", "temporary"].includes(scope.kind))
      throw new Error("Invalid Claude task scope");
    const provider = runtime.forScope(scope);
    if (!subscribed.has(provider)) {
      subscribed.add(provider);
      provider.subscribeEvents((event) => {
        send({ event, projectId: scope.id });
      });
    }
    const id = typeof params["taskId"] === "string" ? params["taskId"] : "";
    switch (method) {
      case "mcp.list":
        return provider.listMcpServers(id);
      case "mcp.reload": {
        const request = params["action"] == null ? {} : { action: params["action"] };
        if (!Value.Check(ReloadAgentMcpServersRequestSchema, request))
          throw new Error("Invalid MCP action");
        return provider.reloadMcpServers(id, request.action);
      }
      case "attachment.export":
        return exportClaudeAttachment(provider, id, String(params["attachmentId"]));
      case "task.read": {
        // 校验通过即同步进入同一写队列；原生层按事件/响应帧顺序捕获项目序号。
        const read = await readTaskWithCheckpoint(
          provider,
          id,
          record(params["options"]),
          (snapshot) => {
            send({ id: message["id"], result: snapshot, snapshotProjectId: scope.id });
          },
        );
        return read === undefined ? undefined : snapshotResponseSent;
      }
      // 与 Web 共用生命周期检查；成功响应前必须完成空闲会话关闭和目录记录更新。
      case "task.archive":
        return provider.archiveTask(id);
      case "task.delete":
        return provider.deleteTask(id);
      case "turn.start":
        if (!Value.Check(AgentTurnOptionsSchema, params["options"]))
          throw new Error("Invalid Claude turn options");
        return provider.startTurn(id, params["input"] as AgentProviderTurnInput, params["options"]);
      case "session.stop":
        await provider.stopSession(
          id,
          typeof params["backgroundTaskId"] === "string" ? params["backgroundTaskId"] : undefined,
        );
        return { status: "accepted", taskId: id };
      case "turn.interrupt":
        await provider.interruptTurn(id, String(params["turnId"]));
        return {};
      case "request.resolve":
        return provider.resolvePendingRequest(params as ResolvePendingRequestInput);
      default:
        throw new Error("Unsupported Claude host method");
    }
  };
  let pending = Buffer.alloc(0),
    active = 0;
  process.stdin.on("data", (chunk: Buffer) => {
    if (closed) return;
    pending = Buffer.concat([pending, chunk]);
    let end: number;
    while ((end = pending.indexOf(10)) >= 0) {
      if (end + 1 > 8 * 1024 * 1024) {
        close("stdin frame budget exceeded");
        return;
      }
      const line = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(line.toString("utf8")));
      } catch {
        close("invalid stdin frame");
        return;
      }
      if (typeof message["catalogId"] === "number") {
        const deferred = catalogRequests.get(message["catalogId"]);
        if (message["error"])
          deferred?.reject(
            new Error(
              typeof message["error"] === "string" ? message["error"] : "Catalog request failed",
            ),
          );
        else deferred?.resolve(message["result"]);
      } else if (typeof message["id"] === "number") {
        const id = message["id"];
        if (active >= 32) {
          send({ id, error: "Claude host request capacity exceeded" });
          continue;
        }
        active++;
        void execute(message)
          .then(
            (result) => {
              if (result !== snapshotResponseSent) send({ id, result: result ?? null });
            },
            (error: unknown) => {
              send({ id, error: error instanceof Error ? error.message : "Claude request failed" });
            },
          )
          .catch(() => {
            close("request delivery failed");
          })
          .finally(() => {
            active--;
          });
      } else {
        close("invalid stdin envelope");
        return;
      }
    }
    if (pending.length >= 8 * 1024 * 1024) close("stdin frame budget exceeded");
  });
  process.stdin.on("error", () => {
    close("stdin read failed");
  });
  process.stdin.on("end", () => {
    close(pending.length ? "truncated stdin frame" : "stdin ended", pending.length > 0);
  });
}
