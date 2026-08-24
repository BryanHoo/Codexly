import type { AgentBackgroundTerminal } from "@codexly/protocol";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { v4 as createUuid } from "uuid";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import type { CodexlyBackgroundTerminalClient } from "../../projects/project-queries.js";

const BACKGROUND_TERMINAL_POLL_INTERVAL_MS = 1_500;

export function getBackgroundTerminalPollInterval(
  isTaskRunning: boolean,
  terminalCount: number,
): number | false {
  return isTaskRunning || terminalCount > 0 ? BACKGROUND_TERMINAL_POLL_INTERVAL_MS : false;
}

export function shouldRefreshBackgroundTerminals(
  enabled: boolean,
  previousTaskRunning: boolean,
  isTaskRunning: boolean,
  taskId: string | undefined,
): boolean {
  return enabled && taskId !== undefined && previousTaskRunning !== isTaskRunning;
}

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
    refetchInterval(query) {
      // Turn 已结束但终端仍存在时继续轮询，直到 Provider 确认进程退出。
      return getBackgroundTerminalPollInterval(isTaskRunning, query.state.data?.data.length ?? 0);
    },
  });
  const terminateMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      if (taskId === undefined) {
        return;
      }
      const idempotencyKey = idempotencyKeysRef.current.get(terminalId) ?? createUuid();
      idempotencyKeysRef.current.set(terminalId, idempotencyKey);
      await client.terminateBackgroundTerminal(projectId, taskId, terminalId, { idempotencyKey });
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
          await refetchTerminals();
        } catch {
          // 根级 MutationCache 已展示失败 toast，终端列表保持原状态供重试。
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
