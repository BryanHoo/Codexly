import type { AgentProviderEventListener } from "@codexly/core";
import { record, text } from "./sdk-values.js";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentContextUsage, AgentMcpServer, AgentPlan } from "@codexly/protocol";
import { CLAUDE_PLAN_MAX_TASKS, CLAUDE_PLAN_TITLE_BYTES } from "./task-plan.js";
import { previewText } from "./rendering-buffer.js";

/** 仅限制等待时间，不取消 SDK 请求；消息消费关键路径不得 await 此观测。 */
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

// SDK 未提供单请求取消接口；锁必须跟随底层 Promise，不能在观测超时时提前释放。
const pendingContextQueries = new WeakSet<Query>();

export async function refreshClaudeContext(
  query: Query,
  projection: {
    readonly status: string;
    readonly contextUsage: AgentContextUsage | null;
    readonly changes: { readonly revision: number };
    updateContextUsage: (usage: AgentContextUsage) => void;
  },
  initial = false,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (
    !isCurrent() ||
    typeof query.getContextUsage !== "function" ||
    pendingContextQueries.has(query)
  )
    return false;
  const revision = projection.changes.revision,
    previousUsage = projection.contextUsage;
  pendingContextQueries.add(query);
  // summary 复用最近响应统计及本地估计，不产生额外计数 API 调用。
  const context = await observe(async () => {
    try {
      return await query.getContextUsage({ detail: "summary" });
    } finally {
      pendingContextQueries.delete(query);
    }
  });
  // 回合身份、正文版本和最近主请求用量任一变化，迟到统计都不能覆盖当前上下文。
  if (
    !isCurrent() ||
    projection.changes.revision !== revision ||
    projection.contextUsage !== previousUsage ||
    (initial && projection.status !== "running")
  )
    return false;
  if (
    !context ||
    !Number.isSafeInteger(context.totalTokens) ||
    context.totalTokens < 0 ||
    !Number.isSafeInteger(context.rawMaxTokens) ||
    context.rawMaxTokens <= 0
  )
    return false;
  projection.updateContextUsage({
    usedTokens: initial
      ? (projection.contextUsage?.usedTokens ?? context.totalTokens)
      : context.totalTokens,
    contextWindow: context.rawMaxTokens,
  });
  return projection.contextUsage !== previousUsage;
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
    // 仅展示地址来源；配置中的凭据、路径、查询参数和启动命令不得越过 Provider 边界。
    const config = record(server["config"]);
    let httpOrigin: string | undefined;
    if (typeof config["url"] === "string") {
      try {
        const url = new URL(config["url"]);
        if (url.protocol === "https:" || url.protocol === "http:") httpOrigin = url.origin;
      } catch {
        /* 无效地址交由 SDK 报告连接状态。 */
      }
    }
    return [
      {
        name: value.name,
        displayName: value.name,
        ...(httpOrigin ? { httpOrigin } : {}),
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
  const inputTokens =
    count("input_tokens") + count("cache_read_input_tokens") + count("cache_creation_input_tokens");
  // 流式请求尚未提供输入统计时，零值与仅有输出的增量都不代表上下文已清空。
  if (inputTokens === 0) return undefined;
  return { contextWindow, usedTokens: inputTokens + count("output_tokens") };
}

export function mapClaudePlan(input: unknown): AgentPlan | undefined {
  const todos = record(input)["todos"];
  if (!Array.isArray(todos)) return undefined;
  return {
    explanation: null,
    steps: todos.slice(0, CLAUDE_PLAN_MAX_TASKS).flatMap((value) => {
      const todo = record(value),
        status = todo["status"],
        content = text(todo["content"]);
      return content && (status === "pending" || status === "in_progress" || status === "completed")
        ? [{ text: previewText(content, CLAUDE_PLAN_TITLE_BYTES), status }]
        : [];
    }),
  };
}

/** 新旧任务工具共用同一计划事件；没有有效变更时保留现有投影。 */
export function publishClaudePlan(
  projection: { plan: AgentPlan | null },
  plan: AgentPlan | undefined,
  taskId: string,
  turnId: string,
  emit: AgentProviderEventListener,
): void {
  if (!plan) return;
  projection.plan = plan;
  emit({ type: "plan.updated", taskId, turnId, payload: { plan } });
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
