import type { AgentBackgroundTerminal } from "@codexly/protocol";
import { getBackgroundTerminalPollInterval } from "./background-terminal-polling.js";

export type BackgroundTerminalRuntime = "pending" | "legacy" | "acp";
export function assertLegacyBackgroundTerminals(runtime: BackgroundTerminalRuntime): void {
  if (runtime !== "legacy") throw new Error("当前运行时不支持旧后台终端接口");
}

/** 应用后台终端接口与 ACP client terminal 能力不同，不能通过旧缓存或手动刷新回退。 */
export function backgroundTerminalQuery(
  projectId: string,
  taskId: string | undefined,
  client: {
    listBackgroundTerminals(
      projectId: string,
      taskId: string,
      options?: { signal?: AbortSignal },
    ): Promise<{ data: readonly AgentBackgroundTerminal[] }>;
  },
  running: boolean,
  enabled: boolean,
  runtime: BackgroundTerminalRuntime,
) {
  const key = ["projects", projectId, "tasks", taskId, "background-terminals"] as const;
  return {
    enabled: runtime === "legacy" && enabled && taskId !== undefined,
    queryKey: runtime === "legacy" ? key : ([...key, runtime] as const),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      assertLegacyBackgroundTerminals(runtime);
      if (taskId === undefined) throw new Error("Background terminal query requires a task");
      return client.listBackgroundTerminals(projectId, taskId, { signal });
    },
    staleTime: 0,
    refetchInterval(query: {
      state: { data: { data: readonly AgentBackgroundTerminal[] } | undefined };
    }) {
      return runtime === "legacy" && enabled
        ? getBackgroundTerminalPollInterval(running, query.state.data?.data.length ?? 0)
        : false;
    },
    refetchIntervalInBackground: false,
  };
}
