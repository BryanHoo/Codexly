import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMcpServerPage, ReloadAgentMcpServersRequest } from "@codexly/protocol";
import { mapClaudeMcpServers, observe } from "./observability.js";

export type ClaudeMcpAction = NonNullable<ReloadAgentMcpServersRequest["action"]>;

export interface ClaudeMcpSnapshot {
  mcpServers: AgentMcpServerPage["data"];
  mcpObservedAt?: string | null;
}

// 多个分屏共用同一在途控制请求；超时不代表 SDK 已取消，必须等底层结算再释放。
const pendingStatuses = new WeakMap<Query, ReturnType<Query["mcpServerStatus"]>>();
function readStatus(query: Query): ReturnType<Query["mcpServerStatus"]> {
  let pending = pendingStatuses.get(query);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => query.mcpServerStatus())
      .finally(() => {
        pendingStatuses.delete(query);
      });
    pendingStatuses.set(query, pending);
  }
  return pending;
}

/** 超时或断连时保留原时间，不能把历史数据重新盖章为实时状态。 */
export async function refreshClaudeMcpSnapshot(
  query: Query,
  snapshot: ClaudeMcpSnapshot,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (typeof query.mcpServerStatus !== "function") return false;
  const servers = await observe(() => readStatus(query));
  if (!servers || !isCurrent()) return false;
  snapshot.mcpServers = mapClaudeMcpServers(servers);
  snapshot.mcpObservedAt = new Date().toISOString();
  return true;
}

/** 重连仅针对 SDK 当前失败/待认证服务，不声称已经重新加载原生配置。 */
export async function reconnectClaudeMcpServers(query: Query): Promise<void> {
  const servers = await observe(() => readStatus(query));
  if (!servers) throw new Error("无法读取 MCP 实时状态，请稍后重试");
  await Promise.all(
    servers
      .filter((server) => server.status === "failed" || server.status === "needs-auth")
      .map((server) => query.reconnectMcpServer(server.name)),
  );
}
