import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { codexlyClient, type CodexlyAppUpdateClient } from "./project-query-contracts.js";

export function appInfoQueryOptions(client: CodexlyAppUpdateClient = codexlyClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getAppInfo({ signal }),
    queryKey: ["app-info"] as const,
    staleTime: 5 * 60_000,
  });
}

export function refreshAppInfo(
  queryClient: QueryClient,
  client: CodexlyAppUpdateClient = codexlyClient,
) {
  // fetchQuery 合并在途检查并同步查询状态；显式刷新同时绕过浏览器和服务端缓存。
  return queryClient
    .fetchQuery({
      ...appInfoQueryOptions(client),
      queryFn: ({ signal }) => client.getAppInfo({ refresh: true, signal }),
      staleTime: 0,
    })
    .catch(() => undefined); // 错误保留在查询状态中，由关于页展示并允许重试。
}

export function appUpdateProgressQueryOptions(
  client: CodexlyAppUpdateClient = codexlyClient,
  enabled = false,
) {
  return queryOptions({
    enabled,
    queryFn: ({ signal }) => client.getAppUpdateProgress({ signal }),
    queryKey: ["app-update", "progress"] as const,
    refetchInterval: enabled ? 250 : false,
  });
}

export function appUpdateMutationOptions(client: CodexlyAppUpdateClient = codexlyClient) {
  return mutationOptions({
    mutationFn: (version: string) => client.installAppUpdate(version),
    mutationKey: ["app-update", "install"] as const,
    scope: { id: "app-update" },
  });
}
