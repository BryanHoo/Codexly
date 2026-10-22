import type { AgentTask } from "@codexly/protocol";
import type { SidebarTimelineRecent } from "@codexly/frontend-core/sidebar-timeline-recent";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

export type SidebarTimelineQuery = Readonly<{
  queryKey: readonly string[];
  queryFn: (context: { signal: AbortSignal }) => Promise<readonly AgentTask[]>;
  recentQueryFn?: (context: {
    signal: AbortSignal;
    since: number;
  }) => Promise<SidebarTimelineRecent>;
}>;

function combineCatalogs(results: UseQueryResult<readonly AgentTask[]>[]) {
  return {
    collections: results.map((result) => result.data),
    isPending: results.some((result) => result.isPending),
    failures: results.filter((result) => result.isError).map((result) => result.refetch),
  };
}

function combineRecent(results: UseQueryResult<SidebarTimelineRecent>[]) {
  return {
    collections: results.map((result) => result.data?.tasks ?? []),
    isPending: results.some((result) => result.isPending),
    failures: results.filter((result) => result.isError).map((result) => result.refetch),
    hasEarlier: results.some((result) => result.data?.hasEarlier),
    earlierCount: results.some((result) => result.data?.earlierCount == null)
      ? null
      : results.reduce((count, result) => count + (result.data?.earlierCount ?? 0), 0),
  };
}

export function useSidebarTimelineCatalog(
  queries: readonly SidebarTimelineQuery[],
  includeEarlier: boolean,
  day: number,
) {
  const now = new Date(day);
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const useFullCatalog =
    includeEarlier || queries.some((query) => query.recentQueryFn === undefined);
  const recent = useQueries({
    queries: queries.flatMap((query) => {
      const load = query.recentQueryFn;
      return load === undefined
        ? []
        : [
            {
              queryKey: [...query.queryKey.slice(0, 3), "timeline-recent", since],
              queryFn: ({ signal }: { signal: AbortSignal }) => load({ signal, since }),
              enabled: !useFullCatalog,
            },
          ];
    }),
    combine: combineRecent,
  });
  const complete = useQueries({
    // 完整目录仅在展开“更早”时观察；短期重开复用缓存，写操作和焦点事件仍可显式失效。
    queries: queries.map((query) => ({
      queryKey: query.queryKey,
      queryFn: query.queryFn,
      enabled: useFullCatalog,
      staleTime: 30_000,
    })),
    combine: combineCatalogs,
  });
  return useMemo(() => {
    if (
      !useFullCatalog &&
      recent.isPending &&
      complete.collections.some((tasks) => tasks !== undefined && tasks.length > 0)
    ) {
      return {
        ...complete,
        collections: complete.collections.map((tasks) => tasks ?? []),
        isPending: true,
        hasEarlier: false,
        earlierCount: 0,
      };
    }
    if (!useFullCatalog) return recent;
    // 各项目独立发布成功结果；尚未返回或失败的项目保留近期列表，不因另一项目失败隐藏历史。
    const hasUnloadedEarlier =
      recent.hasEarlier && complete.collections.some((tasks) => tasks === undefined);
    return {
      ...complete,
      collections: complete.collections.map(
        (tasks, index) => tasks ?? recent.collections[index] ?? [],
      ),
      hasEarlier: hasUnloadedEarlier,
      earlierCount: hasUnloadedEarlier ? null : 0,
    };
  }, [complete, recent, useFullCatalog]);
}
