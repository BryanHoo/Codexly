import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AgentTask } from "@codexly/protocol";

import type { CodexlyGlobalSearchClient } from "../projects/project-query-contracts.js";

export function useSearchOccurrences(
  client: CodexlyGlobalSearchClient,
  task: AgentTask | null,
  query: string,
  open: boolean,
) {
  const [pagination, setPagination] = useState<{
    cursors: (string | undefined)[];
    key: string;
  }>({ cursors: [undefined], key: "" });
  const key = JSON.stringify([task?.projectId, task?.id, query]);
  const cursors = pagination.key === key ? pagination.cursors : [undefined];
  const targetTask = task;
  const results = useQuery({
    enabled: open && task !== null && query.length > 0,
    gcTime: 30_000,
    queryFn: ({ signal }) => {
      if (targetTask === null) throw new Error("Search task is unavailable");
      return client.searchTaskOccurrences(
        targetTask.projectId,
        targetTask.id,
        query,
        cursors.at(-1),
        { signal },
      );
    },
    queryKey: ["global-search", "occurrences", task?.projectId, task?.id, query, cursors.at(-1)],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  return {
    hasPrevious: cursors.length > 1,
    next: () => {
      setPagination({ cursors: [...cursors, results.data?.nextCursor ?? undefined], key });
    },
    previous: () => {
      setPagination({ cursors: cursors.slice(0, -1), key });
    },
    results,
  };
}
