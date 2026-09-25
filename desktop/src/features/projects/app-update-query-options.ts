import type { AppUpdateInstallProgress } from "@/protocol/index.js";
import { mutationOptions, queryOptions } from "@tanstack/react-query";

import { nativeClient, type NativeAppUpdateClient } from "./project-query-contracts.js";

export function appInfoQueryOptions(client: NativeAppUpdateClient = nativeClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.getAppInfo({ signal }),
    queryKey: ["app-info"] as const,
    staleTime: 5 * 60_000,
  });
}

export function appUpdateMutationOptions(client: NativeAppUpdateClient = nativeClient) {
  return mutationOptions({
    meta: { actionNotification: { successMessage: false } },
    mutationFn: ({
      onProgress,
      version,
    }: Readonly<{
      onProgress: (progress: AppUpdateInstallProgress) => void;
      version: string;
    }>) => client.installAppUpdate(version, { onProgress }),
    mutationKey: ["app-update", "install"] as const,
    scope: { id: "app-update" },
  });
}
