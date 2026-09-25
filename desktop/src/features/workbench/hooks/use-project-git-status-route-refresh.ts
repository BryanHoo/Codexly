import { useEffect, useRef } from "react";

type GitStatusQuery = Readonly<{
  isPending: boolean;
  refetch: () => Promise<unknown>;
}>;

export function useProjectGitStatusRouteRefresh(
  routeScope: string,
  enabled: boolean,
  query: GitStatusQuery,
): void {
  const previousRouteScopeRef = useRef<string | undefined>(undefined);
  const { isPending, refetch } = query;

  useEffect(() => {
    const routeChanged = previousRouteScopeRef.current !== routeScope;
    previousRouteScopeRef.current = routeScope;
    // 首次无缓存加载已经在请求；复用缓存或切换任务时必须重新读取。
    if (!enabled || !routeChanged || isPending) return;
    void refetch();
  }, [enabled, isPending, refetch, routeScope]);
}
