import type { AgentMcpServerPage, ReloadAgentMcpServersRequest } from "@codexly/protocol";

type Runtime = "pending" | "legacy" | "acp";
interface Client {
  listMcpServers(
    project: string,
    task: string,
    options?: { signal?: AbortSignal },
  ): Promise<AgentMcpServerPage>;
  retryMcpServers(
    project: string,
    task: string,
    body?: ReloadAgentMcpServersRequest,
  ): Promise<AgentMcpServerPage>;
}
function assertLegacy(runtime: Runtime): void {
  if (runtime !== "legacy") throw new Error("当前运行时不支持旧 MCP 状态接口");
}
/** 自动查询与手动 refetch 共用执行边界；非旧运行时也不能复用仍新鲜的旧缓存。 */
export function legacyMcpQuery(
  project: string,
  task: string | undefined,
  client: Pick<Client, "listMcpServers">,
  enabled: boolean,
  runtime: Runtime,
) {
  const key = ["projects", project, "tasks", task ?? null, "mcp-servers"] as const;
  return {
    enabled: runtime === "legacy" && enabled && task !== undefined,
    queryKey: runtime === "legacy" ? key : ([...key, runtime] as const),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<AgentMcpServerPage> => {
      assertLegacy(runtime);
      if (task === undefined) return { data: [] };
      return client.listMcpServers(project, task, { signal });
    },
  };
}
/** 变更不能只依赖按钮禁用；非旧运行时的外部调用也必须在发送前拒绝。 */
export function legacyMcpReload(
  project: string,
  task: string | undefined,
  client: Pick<Client, "retryMcpServers">,
  runtime: Runtime,
) {
  const key = ["projects", project, "tasks", task ?? null, "mcp-servers", "reload"] as const;
  return {
    mutationKey: runtime === "legacy" ? key : ([...key, runtime] as const),
    scope: { id: `task-mcp:${project}:${task ?? "none"}` },
    mutationFn: async (
      action?: ReloadAgentMcpServersRequest["action"],
    ): Promise<AgentMcpServerPage> => {
      assertLegacy(runtime);
      if (task === undefined) throw new Error("Cannot reload MCP servers without a task");
      return action
        ? client.retryMcpServers(project, task, { action })
        : client.retryMcpServers(project, task);
    },
  };
}
