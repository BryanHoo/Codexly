import {
  backgroundTerminalQuery,
  assertLegacyBackgroundTerminals,
  type BackgroundTerminalRuntime,
} from "@codexly/frontend-core/background-terminal-query";
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
  runtime: BackgroundTerminalRuntime = "legacy",
): BackgroundTerminalView {
  const queryClient = useQueryClient();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const previousTaskRunningRef = useRef(isTaskRunning);
  const idempotencyKeysRef = useRef(new Map<string, string>());
  const terminateLockRef = useRef(createAsyncActionLock());
  const terminalsQuery = useQuery(
    backgroundTerminalQuery(projectId, taskId, client, isTaskRunning, enabled, runtime),
  );
  const terminateMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      assertLegacyBackgroundTerminals(runtimeRef.current);
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
      enabled && runtime === "legacy",
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
  }, [enabled, isTaskRunning, refetchTerminals, runtime, taskId]);

  const terminateTerminal = useCallback(
    async (terminalId: string) => {
      // 旧引用可能留在弹窗里，使用当前运行时再次确认，拒绝时不能进入失败刷新。
      assertLegacyBackgroundTerminals(runtimeRef.current);
      await terminateLockRef.current.run(async () => {
        try {
          await terminateTerminalMutation(terminalId);
          idempotencyKeysRef.current.delete(terminalId);
        } catch (error) {
          // 进程可能已自然退出；失败后重新读取权威列表，避免残留无法结束的命令。
          // 根级 MutationCache 仍负责展示真实请求错误。
          if (runtimeRef.current !== "legacy")
            throw error instanceof Error ? error : new Error("后台终端终止失败", { cause: error });
          await refetchTerminals();
        }
      });
    },
    [refetchTerminals, terminateTerminalMutation],
  );

  return {
    error: runtime === "legacy" ? terminalsQuery.error : null,
    isPending: runtime === "legacy" && terminalsQuery.isPending,
    terminals: runtime === "legacy" ? (terminalsQuery.data?.data ?? []) : [],
    terminatingTerminalId:
      runtime === "legacy" &&
      terminateMutation.isPending &&
      typeof terminateMutation.variables === "string"
        ? terminateMutation.variables
        : null,
    terminateTerminal,
  };
}
