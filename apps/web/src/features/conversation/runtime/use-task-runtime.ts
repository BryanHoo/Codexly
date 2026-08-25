import type { AgentTaskSnapshotResponse } from "@codexly/protocol";
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { taskSnapshotQueryOptions } from "../../projects/project-queries.js";
import type { ProjectRuntimeManager } from "./project-runtime.js";
import {
  createTaskStore,
  createTaskStoreRegistry,
  type ReconstructedTaskSnapshot,
  type TaskStore,
  type TaskSnapshotMetadata,
} from "./task-store.js";

const taskStoreRegistry = createTaskStoreRegistry({ maxRetainedStores: 20 });
const emptyTaskStore = createTaskStore({ projectId: "", taskId: "" });

export type TaskRuntimeView = Readonly<{
  activeTurnId: string | undefined;
  connectionState: "closed" | "connected" | "connecting" | "reconnecting";
  error: Error | null;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  isPending: boolean;
  itemStructureRevision: number;
  loadOlderHistory: () => Promise<void>;
  metadata: TaskSnapshotMetadata | undefined;
  olderHistoryError: Error | null;
  readSnapshot: () => ReconstructedTaskSnapshot | undefined;
  store: TaskStore | undefined;
}>;

export function useTaskRuntime(
  projectId: string,
  taskId: string | undefined,
  projectRuntime: ProjectRuntimeManager,
): TaskRuntimeView {
  const queryClient = useQueryClient();
  const client = projectRuntime.client;
  const taskScope = `${projectId}\u0000${taskId ?? ""}`;
  const [taskQueryState, setTaskQueryState] = useState<
    Readonly<{ error: Error | null; isPending: boolean; scope: string }>
  >({ error: null, isPending: taskId !== undefined, scope: taskScope });
  const [store, setStore] = useState<TaskStore>();
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const [olderHistoryError, setOlderHistoryError] = useState<Error | null>(null);
  const olderHistoryRequestRef = useRef<object | null>(null);
  const subscribedStore = store ?? emptyTaskStore;
  const activeTurnId = useStore(subscribedStore, (state) =>
    state.turnIds.findLast((turnId) => state.turnsById[turnId]?.status === "running"),
  );
  const connectionState = useStore(subscribedStore, (state) => state.connectionState);
  const runtimeError = useStore(subscribedStore, (state) => state.error);
  const metadata = useStore(subscribedStore, (state) => state.snapshotMetadata ?? undefined);
  const itemStructureRevision = useStore(subscribedStore, (state) => state.itemStructureRevision);
  const turnsNextCursor = useStore(subscribedStore, (state) => state.turnsNextCursor);

  useEffect(() => {
    olderHistoryRequestRef.current = null;
    setIsLoadingOlderHistory(false);
    setOlderHistoryError(null);
  }, [projectId, taskId]);

  useEffect(() => {
    if (taskId === undefined) {
      setStore(undefined);
      return;
    }
    const acquiredStore = taskStoreRegistry.acquire(projectId, taskId);
    setStore(acquiredStore);
    return () => {
      taskStoreRegistry.release(projectId, taskId);
    };
  }, [projectId, taskId]);

  useEffect(() => {
    if (store === undefined || taskId === undefined) {
      return;
    }
    const storeIdentity = store.getState();
    if (storeIdentity.projectId !== projectId || storeIdentity.taskId !== taskId) {
      return;
    }
    const controller = new AbortController();
    const queryKey = taskSnapshotQueryOptions(projectId, taskId, client).queryKey;
    let detachStore: (() => void) | undefined;
    let disposed = false;
    setTaskQueryState({ error: null, isPending: true, scope: taskScope });
    const cachedResponse = consumeTaskSnapshotQuery(queryClient, queryKey);
    const initialSnapshot =
      cachedResponse === undefined
        ? client.readTask(projectId, taskId, { signal: controller.signal })
        : Promise.resolve(cachedResponse);
    void initialSnapshot
      .then((response) => {
        if (disposed) {
          return;
        }
        detachStore = projectRuntime.attachTaskStore(response, store, () =>
          client.readTask(projectId, taskId),
        );
        // Store 接管完整历史后清除并发预热留下的 Query Payload。
        queryClient.removeQueries({ exact: true, queryKey });
        setTaskQueryState({ error: null, isPending: false, scope: taskScope });
      })
      .catch((error: unknown) => {
        if (!disposed && !controller.signal.aborted) {
          setTaskQueryState({
            error: error instanceof Error ? error : new Error(String(error)),
            isPending: false,
            scope: taskScope,
          });
        }
      });
    return () => {
      disposed = true;
      controller.abort();
      detachStore?.();
    };
  }, [client, projectId, projectRuntime, queryClient, store, taskId, taskScope]);

  const activeRuntime =
    store === undefined ? undefined : selectActiveTaskStore(store, projectId, taskId);
  const loadOlderHistory = useCallback(async () => {
    if (activeRuntime === undefined || taskId === undefined || turnsNextCursor === null) {
      return;
    }
    if (olderHistoryRequestRef.current !== null) {
      return;
    }
    const requestToken = {};
    olderHistoryRequestRef.current = requestToken;
    setIsLoadingOlderHistory(true);
    setOlderHistoryError(null);
    try {
      const response = await client.readTask(projectId, taskId, { cursor: turnsNextCursor });
      // 分页失败不覆盖实时 Store；成功页通过统一身份校验后再前插。
      activeRuntime.getState().prependHistory(response);
    } catch (error) {
      if (olderHistoryRequestRef.current === requestToken) {
        setOlderHistoryError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (olderHistoryRequestRef.current === requestToken) {
        olderHistoryRequestRef.current = null;
        setIsLoadingOlderHistory(false);
      }
    }
  }, [activeRuntime, client, projectId, taskId, turnsNextCursor]);
  const hasHydratedSnapshot = activeRuntime?.getState().snapshotMetadata !== null;
  const taskQueryError = taskQueryState.scope === taskScope ? taskQueryState.error : null;
  const taskQueryPending =
    taskId !== undefined && (taskQueryState.scope !== taskScope || taskQueryState.isPending);
  const error =
    activeRuntime === undefined || !hasHydratedSnapshot
      ? taskQueryError
      : connectionState === "closed"
        ? runtimeError
        : null;
  const readSnapshot = useCallback(
    () => activeRuntime?.getState().reconstructSnapshot(),
    [activeRuntime],
  );
  const isRuntimePending =
    error === null && (taskQueryPending || activeRuntime === undefined || !hasHydratedSnapshot);

  return useMemo(
    () => ({
      activeTurnId,
      connectionState: activeRuntime === undefined ? "connecting" : connectionState,
      error,
      hasOlderHistory: turnsNextCursor !== null,
      isLoadingOlderHistory,
      isPending: isRuntimePending,
      itemStructureRevision,
      loadOlderHistory,
      metadata,
      olderHistoryError,
      readSnapshot,
      store: activeRuntime,
    }),
    [
      activeRuntime,
      activeTurnId,
      connectionState,
      error,
      isLoadingOlderHistory,
      isRuntimePending,
      itemStructureRevision,
      loadOlderHistory,
      metadata,
      olderHistoryError,
      readSnapshot,
      turnsNextCursor,
    ],
  );
}

export function consumeTaskSnapshotQuery(
  queryClient: Pick<QueryClient, "getQueryData" | "removeQueries">,
  queryKey: QueryKey,
): AgentTaskSnapshotResponse | undefined {
  const response = queryClient.getQueryData<AgentTaskSnapshotResponse>(queryKey);
  if (response !== undefined) {
    queryClient.removeQueries({ exact: true, queryKey });
  }
  return response;
}

export function removeRetainedTaskRuntime(projectId: string, taskId: string): boolean {
  return taskStoreRegistry.remove(projectId, taskId);
}

export function selectActiveTaskStore(
  store: TaskStore | undefined,
  projectId: string,
  taskId: string | undefined,
): TaskStore | undefined {
  const state = store?.getState();
  return taskId !== undefined && state?.projectId === projectId && state.taskId === taskId
    ? store
    : undefined;
}
