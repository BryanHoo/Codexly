import type { QueryClient } from "@tanstack/react-query";

import { ByteLru, estimateRetainedBytes } from "../shared/memory/byte-lru.js";

export const MAX_INACTIVE_SNAPSHOT_BYTES = 48 * 1_048_576;
export const MAX_INACTIVE_SNAPSHOT_ENTRIES = 12;

type TaskSnapshotQueryKey = readonly ["projects", string, "tasks", string];

type InactiveSnapshotEntry = Readonly<{
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
  queryClient: QueryClient,
  maxBytes = MAX_INACTIVE_SNAPSHOT_BYTES,
  maxEntries = MAX_INACTIVE_SNAPSHOT_ENTRIES,
): () => void {
  const inactiveSnapshots = new ByteLru<string, InactiveSnapshotEntry>({
    getRetainedBytes: (_queryHash, entry) => entry.retainedBytes,
    maxBytes,
    maxEntries,
    onEvict(queryHash, entry, reason) {
      if (reason === "replaced") {
        return;
      }
      const query = queryClient.getQueryCache().find({ exact: true, queryKey: entry.queryKey });
      if (query?.getObserversCount() === 0) {
        // QueryCache 是 Snapshot 的唯一所有者；LRU 淘汰时释放整份完整历史。
        queryClient.removeQueries({ exact: true, queryKey: entry.queryKey });
      }
    },
  });

  return queryClient.getQueryCache().subscribe((event) => {
    const query = event.query;
    const queryKey: unknown = query.queryKey;
    const queryHash: unknown = query.queryHash;
    const data: unknown = query.state.data;
    if (!isTaskSnapshotQueryKey(queryKey) || typeof queryHash !== "string") {
      return;
    }
    if (event.type === "removed" || query.getObserversCount() > 0 || data === undefined) {
      inactiveSnapshots.delete(queryHash);
      return;
    }
    inactiveSnapshots.set(queryHash, {
      queryKey,
      retainedBytes: estimateRetainedBytes(data),
    });
  });
}
