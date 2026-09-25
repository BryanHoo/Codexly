import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AgentTask } from "@/protocol/index.js";
import type { NativeWorkbenchClient } from "../projects/project-query-contracts.js";

/** Observer 留在搜索会话内，弹窗 DOM 卸载后仍保留当前匹配页与缓存。 */
export function useSearchOccurrences(client: NativeWorkbenchClient, task: AgentTask | null, query: string, open: boolean) {
  const [pagination, setPagination] = useState<{ key: string; cursors: (string | undefined)[] }>({ key: "", cursors: [undefined] });
  const key = JSON.stringify([task?.id, query]);
  const cursors = pagination.key === key ? pagination.cursors : [undefined];
  const results = useQuery({
    queryKey: ["global-search", "occurrences", task?.id, query, cursors.at(-1)],
    queryFn: ({ signal }) => client.searchTaskOccurrences(task!.id, query, cursors.at(-1), { signal }),
    enabled: open && task !== null && query.length > 0,
    gcTime: 30_000,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    results,
    hasPrevious: cursors.length > 1,
    previous: () => setPagination({ key, cursors: cursors.slice(0, -1) }),
    next: () => setPagination({ key, cursors: [...cursors, results.data?.nextCursor ?? undefined] }),
  };
}
