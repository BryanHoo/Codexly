import type { ProjectGitStatus } from "@/protocol/index.js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { NativeGitStatusClient } from "../../projects/project-queries.js";

export function useCommitStatusPages(client: NativeGitStatusClient, projectId: string, rootPath: string, repository: string | null, initial: ProjectGitStatus) {
  const query = useInfiniteQuery({
    queryKey: ["projects", projectId, rootPath, "git-status-pages", repository, initial.snapshot],
    initialPageParam: undefined as string | undefined,
    initialData: { pages: [initial], pageParams: [undefined] },
    queryFn: ({ pageParam, signal }) => client.getProjectGitStatus(projectId, {
      rootPath, ...(repository === null ? {} : { repository }), ...(pageParam === undefined ? {} : { cursor: pageParam }),
    }, { signal }),
    getNextPageParam: (page, _pages, previous) => page.nextCursor === previous ? undefined : page.nextCursor ?? undefined,
    enabled: false,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  });
  const status = useMemo(() => {
    const latest = query.data.pages.at(-1) ?? initial;
    const staged = new Map<string, ProjectGitStatus["staged"][number]>();
    const unstaged = new Map<string, ProjectGitStatus["unstaged"][number]>();
    // 原生缓存过期会返回新快照首页，只合并相同身份的页，不混入旧选择或旧正文。
    for (const page of query.data.pages) {
      if (page.snapshot !== latest.snapshot) continue;
      for (const change of page.staged) staged.set(change.path, change);
      for (const change of page.unstaged) unstaged.set(change.path, change);
    }
    return { ...latest, staged: [...staged.values()], unstaged: [...unstaged.values()] };
  }, [initial, query.data.pages]);
  return { status, loading: query.isFetchingNextPage, error: query.error, loadMore: () => query.fetchNextPage() };
}
