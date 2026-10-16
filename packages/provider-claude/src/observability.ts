import type { AgentProviderEventListener } from "@codexly/core";
import { record, text } from "./sdk-values.js";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentContextUsage, AgentMcpServer, AgentPlan } from "@codexly/protocol";

/** 控制查询有独立时限；观测失败不能阻塞消息消费或改变执行结果。 */
export async function observe<T>(action: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, 1500);
        timer.unref();
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshClaudeContext(
  query: Query,
  projection: {
    readonly status: string;
    readonly contextUsage: AgentContextUsage | null;
    updateContextUsage: (usage: AgentContextUsage) => void;
  },
  initial = false,
): Promise<void> {
  if (typeof query.getContextUsage !== "function") return;
  // summary 复用最近响应统计及本地估计，不产生额外计数 API 调用。
  const context = await observe(() => query.getContextUsage({ detail: "summary" }));
  if (initial && projection.status !== "running") return;
  if (
    !context ||
    !Number.isSafeInteger(context.totalTokens) ||
    context.totalTokens < 0 ||
    !Number.isSafeInteger(context.rawMaxTokens) ||
    context.rawMaxTokens <= 0
  )
    return;
  projection.updateContextUsage({
    usedTokens: initial
      ? (projection.contextUsage?.usedTokens ?? context.totalTokens)
      : context.totalTokens,
    contextWindow: context.rawMaxTokens,
  });
}

export function mapClaudeMcpServers(values: unknown): AgentMcpServer[] {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 256).flatMap((value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("name" in value) ||
      typeof value.name !== "string" ||
      !value.name
    )
      return [];
    const server = value as Record<string, unknown>,
      status = server["status"];
    return [
      {
        name: value.name,
        displayName: value.name,
        status:
          status === "connected" || status === "failed" || status === "disabled"
            ? status
            : status === "needs-auth"
              ? "authenticationRequired"
              : status === "pending"
                ? "starting"
                : "unknown",
        toolCount: Array.isArray(server["tools"]) ? server["tools"].length : 0,
      },
    ];
  });
}

/** 最近一次主模型请求的统计；缓存 Token 也占用上下文，不能累加会话计费统计。 */
export function mapClaudeUsage(
  value: unknown,
  contextWindow: number | null,
): AgentContextUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  if (typeof usage["input_tokens"] !== "number") return undefined;
  const count = (key: string) =>
    typeof usage[key] === "number" && Number.isSafeInteger(usage[key]) && usage[key] >= 0
      ? usage[key]
      : 0;
  return {
    contextWindow,
    usedTokens:
      count("input_tokens") +
      count("cache_read_input_tokens") +
      count("cache_creation_input_tokens") +
      count("output_tokens"),
  };
}

export function mapClaudePlan(input: unknown): AgentPlan | undefined {
  const todos = record(input)["todos"];
  if (!Array.isArray(todos)) return undefined;
  return {
    explanation: null,
    steps: todos.flatMap((value) => {
      const todo = record(value),
        status = todo["status"],
        content = text(todo["content"]);
      return content && (status === "pending" || status === "in_progress" || status === "completed")
        ? [{ text: content, status }]
        : [];
    }),
  };
}

export function publishClaudeMcpServers(
  taskId: string,
  servers: AgentMcpServer[],
  emit: AgentProviderEventListener,
): void {
  for (const server of servers)
    emit({
      type: "mcp_server.status_updated",
      taskId,
      payload: {
        name: server.name,
        status:
          server.status === "connected"
            ? "ready"
            : server.status === "starting"
              ? "starting"
              : "failed",
        error: null,
        failureReason:
          server.status === "authenticationRequired" ? "reauthenticationRequired" : null,
      },
    });
}

/** result 只补齐主模型窗口，保留最近一次主请求的用量统计。 */
export function mapClaudeResultUsage(
  value: unknown,
  model: string,
  current: AgentContextUsage | null,
): AgentContextUsage | null {
  const window = record(record(record(value)["modelUsage"])[model])["contextWindow"];
  return current && typeof window === "number" && Number.isSafeInteger(window) && window > 0
    ? { ...current, contextWindow: window }
    : current;
}
