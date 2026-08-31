import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { codexlyClient, type CodexlyAppUpdateClient } from "./project-query-contracts.js";

export function appInfoQueryOptions(client: CodexlyAppUpdateClient = codexlyClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getAppInfo({ signal }),
    queryKey: ["app-info"] as const,
    staleTime: 5 * 60_000,
  });
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
