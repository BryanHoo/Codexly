import type { AgentBackgroundTerminal } from "@codexly/protocol";
import {
  getBackgroundTerminalPollInterval,
  shouldRefreshBackgroundTerminals,
} from "@codexly/frontend-core/background-terminal-polling";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { v4 as createUuid } from "uuid";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { CodexlyBackgroundTerminalClient } from "../../projects/project-queries.js";

export { getBackgroundTerminalPollInterval, shouldRefreshBackgroundTerminals };

export type BackgroundTerminalView = Readonly<{
  error: Error | null;
  isPending: boolean;
  terminals: readonly AgentBackgroundTerminal[];
  terminatingTerminalId: string | null;
  terminateTerminal: (terminalId: string) => Promise<void>;
}>;

export function useBackgroundTerminals(
  client: CodexlyBackgroundTerminalClient,
  projectId: string,
  taskId: string | undefined,
  isTaskRunning: boolean,
  enabled = true,
): BackgroundTerminalView {
  const queryClient = useQueryClient();
  const previousTaskRunningRef = useRef(isTaskRunning);
  const idempotencyKeysRef = useRef(new Map<string, string>());
  const terminateLockRef = useRef(createAsyncActionLock());
  const terminalsQuery = useQuery({
    enabled: enabled && taskId !== undefined,
    queryFn: ({ signal }) => {
      if (taskId === undefined) {
        throw new Error("Background terminal query requires a task");
      }
      return client.listBackgroundTerminals(projectId, taskId, { signal });
    },
    queryKey: ["projects", projectId, "tasks", taskId, "background-terminals"] as const,
    // 进程存活状态不能沿用全局 30 秒新鲜期；重新打开任务或上下文时校准缓存。
    staleTime: 0,
    refetchInterval(query) {
      // Turn 已结束但终端仍存在时继续轮询，直到 Provider 确认进程退出。
      return getBackgroundTerminalPollInterval(isTaskRunning, query.state.data?.data.length ?? 0);
    },
    refetchIntervalInBackground: false,
  });
  const terminateMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      if (taskId === undefined) {
        throw new Error("Background terminal termination requires a task");
      }
      const idempotencyKey = idempotencyKeysRef.current.get(terminalId) ?? createUuid();
      idempotencyKeysRef.current.set(terminalId, idempotencyKey);
      return client.terminateBackgroundTerminal(projectId, taskId, terminalId, { idempotencyKey });
    },
    onSuccess: (response) => {
      queryClient.setQueryData(
        ["projects", projectId, "tasks", taskId, "background-terminals"],
        response.terminals,
      );
    },
  });
  const refetchTerminals = terminalsQuery.refetch;
  const terminateTerminalMutation = terminateMutation.mutateAsync;

  useEffect(() => {
    const shouldRefresh = shouldRefreshBackgroundTerminals(
      enabled,
      previousTaskRunningRef.current,
      isTaskRunning,
      taskId,
    );
    previousTaskRunningRef.current = isTaskRunning;
    if (!shouldRefresh) {
      return;
    }
    // Turn 终态到达时立即读取一次，不能把仍存活的后台终端随回复一起清除。
    void refetchTerminals();
  }, [enabled, isTaskRunning, refetchTerminals, taskId]);

  const terminateTerminal = useCallback(
    (terminalId: string) =>
      terminateLockRef.current.run(async () => {
        try {
          await terminateTerminalMutation(terminalId);
          idempotencyKeysRef.current.delete(terminalId);
        } catch {
          // 进程可能已自然退出；失败后重新读取权威列表，避免残留无法结束的命令。
          // 根级 MutationCache 仍负责展示真实请求错误。
          await refetchTerminals();
        }
      }),
    [refetchTerminals, terminateTerminalMutation],
  );

  return {
    error: terminalsQuery.error,
    isPending: terminalsQuery.isPending,
    terminals: terminalsQuery.data?.data ?? [],
    terminatingTerminalId:
      terminateMutation.isPending && typeof terminateMutation.variables === "string"
        ? terminateMutation.variables
        : null,
    terminateTerminal,
  };
}
