import { exportClaudeAttachment } from "./attachment-export.js";
import { Value } from "@sinclair/typebox/value";
import { AgentTurnOptionsSchema } from "@codexly/protocol";
import { resolve } from "node:path";
import { query, getSessionMessages, getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AgentTaskScope, CatalogOperations, LocalCatalogStore } from "@codexly/core";
import type { AgentProviderTurnInput, ResolvePendingRequestInput } from "@codexly/core";
import type { ClaudeSettings, ConfigureCustomProviderRequest } from "@codexly/protocol";
import { ClaudeRuntime } from "./runtime.js";
import { record } from "./turn-projection.js";

const HOST_VERSION = "codexly-claude-host/1 sdk/0.3.300";
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
  const send = (message: unknown) => {
    const frame = `${JSON.stringify(message)}\n`;
    if (
      Buffer.byteLength(frame) > 8 * 1024 * 1024 ||
      process.stdout.writableLength > 8 * 1024 * 1024
    )
      throw new Error("Claude host transport budget exceeded");
    process.stdout.write(frame);
  };
  const store: LocalCatalogStore = {
    async catalog<K extends keyof CatalogOperations>(
      operation: K,
      payload: CatalogOperations[K][0],
    ): Promise<CatalogOperations[K][1]> {
      if (catalogRequests.size >= 64) throw new Error("Catalog request capacity exceeded");
      const id = nextCatalogId++,
        deferred = Promise.withResolvers<unknown>();
      catalogRequests.set(id, deferred);
      send({ catalogId: id, operation, payload });
      const timeout = setTimeout(() => {
        deferred.reject(new Error("Catalog request timed out"));
      }, 30_000);
      try {
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
      case "mcp.reload":
        return provider.reloadMcpServers(id);
      case "attachment.export":
        return exportClaudeAttachment(provider, id, String(params["attachmentId"]));
      case "task.read":
        return provider.readTask(id, record(params["options"]));
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
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 8 * 1024 * 1024) {
      runtime.close();
      process.exitCode = 1;
      process.stdin.destroy();
      return;
    }
    let end: number;
    while ((end = pending.indexOf(10)) >= 0) {
      const line = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(line.toString("utf8")));
      } catch {
        continue;
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
              send({ id, result: result ?? null });
            },
            (error: unknown) => {
              send({ id, error: error instanceof Error ? error.message : "Claude request failed" });
            },
          )
          .finally(() => {
            active--;
          });
      }
    }
  });
  process.stdin.on("end", () => {
    runtime.close();
    for (const request of catalogRequests.values()) request.reject(new Error("Claude host closed"));
  });
}
