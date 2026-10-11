import { ByteLru, estimateRetainedBytes } from "./byte-lru.js";

export const MAX_INACTIVE_SNAPSHOT_BYTES = 48 * 1_048_576;
export const MAX_INACTIVE_SNAPSHOT_ENTRIES = 12;

type TaskSnapshotQueryKey = readonly ["projects", string, "tasks", string];
type SnapshotQuery = Readonly<{
  queryHash: string;
  queryKey: readonly unknown[];
  state: Readonly<{ data: unknown; dataUpdatedAt: number }>;
  getObserversCount: () => number;
}>;
type SnapshotQueryFilter = Readonly<{ exact: true; queryKey: TaskSnapshotQueryKey }>;

// 只依赖缓存实际使用的公共契约，避免两端 ESM/CJS 类型解析引入私有类身份差异。
export type SnapshotMemoryQueryClient = Readonly<{
  getQueryCache: () => Readonly<{
    find: (filter: SnapshotQueryFilter) => SnapshotQuery | undefined;
    get: (queryHash: string) => SnapshotQuery | undefined;
    getAll: () => SnapshotQuery[];
    subscribe: (listener: (event: Readonly<{ query: SnapshotQuery }>) => void) => () => void;
  }>;
  removeQueries: (filter: SnapshotQueryFilter) => void;
}>;
type InactiveSnapshotEntry = Readonly<{
  data: unknown;
  dataUpdatedAt: number;
  queryKey: TaskSnapshotQueryKey;
  retainedBytes: number;
}>;

function isTaskSnapshotQueryKey(queryKey: unknown): queryKey is TaskSnapshotQueryKey {
  return (
    Array.isArray(queryKey) &&
    queryKey.length === 4 &&
    queryKey[0] === "projects" &&
    typeof queryKey[1] === "string" &&
    queryKey[2] === "tasks" &&
    typeof queryKey[3] === "string"
  );
}

export function installInactiveSnapshotMemoryLimit(
  queryClient: SnapshotMemoryQueryClient,
  maxBytes = MAX_INACTIVE_SNAPSHOT_BYTES,
  maxEntries = MAX_INACTIVE_SNAPSHOT_ENTRIES,
): () => void {
  const queryCache = queryClient.getQueryCache();
  const inactiveSnapshots = new ByteLru<string, InactiveSnapshotEntry>({
    getRetainedBytes: (_queryHash, entry) => entry.retainedBytes,
    maxBytes,
    maxEntries,
    onEvict(_queryHash, entry, reason) {
      if (reason === "replaced") return;
      const query = queryCache.find({ exact: true, queryKey: entry.queryKey });
      if (query?.getObserversCount() === 0) {
        // QueryCache 拥有完整历史；预算淘汰必须同时移除真实快照，不能只清理计数。
        queryClient.removeQueries({ exact: true, queryKey: entry.queryKey });
      }
    },
  });

  function reconcile(query: SnapshotQuery): void {
    const { queryHash, queryKey } = query;
    if (!isTaskSnapshotQueryKey(queryKey)) return;
    const data: unknown = query.state.data;
    if (
      queryCache.get(queryHash) !== query ||
      query.getObserversCount() > 0 ||
      data === undefined
    ) {
      // 淘汰会同步触发缓存事件，过期事件不得重新登记已移除的快照。
      inactiveSnapshots.delete(queryHash);
      return;
    }
    const existing = inactiveSnapshots.peek(queryHash);
    if (existing?.data === data && existing.dataUpdatedAt === query.state.dataUpdatedAt) return;
    // 同一正文的失效、取数状态等元数据变化不重新扫描全文，也不刷新 LRU 顺序。
    const retained = inactiveSnapshots.set(queryHash, {
      data,
      dataUpdatedAt: query.state.dataUpdatedAt,
      queryKey,
      // 成功刷新可能复用原正文引用：更新最近使用顺序，但直接复用已有大小估算。
      retainedBytes: existing?.data === data ? existing.retainedBytes : estimateRetainedBytes(data),
    });
    if (!retained && query.getObserversCount() === 0) {
      // 超大快照或零容量会被 LRU 拒收，此时没有淘汰回调，必须主动释放。
      queryClient.removeQueries({ exact: true, queryKey });
    }
  }

  const unsubscribe = queryCache.subscribe((event) => {
    reconcile(event.query);
  });
  // 安装前已经预取或恢复的缓存同样受预算约束，按正文更新时间登记淘汰顺序。
  for (const query of queryCache
    .getAll()
    .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)) {
    reconcile(query);
  }
  return unsubscribe;
}
