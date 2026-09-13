import type { CodexlyClient } from "@codexly/client";
import type {
  AgentProviderConnectionStatus,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@codexly/protocol";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { codexlyClient } from "../projects/project-query-contracts.js";

export const providerConnectionQueryKey = ["provider-connection"] as const;

export function providerConnectionRefetchInterval(
  status: AgentProviderConnectionStatus | undefined,
): number | false {
  return status?.state === "pending" ? 1_000 : false;
}

type ProviderConnectionReadClient = Pick<CodexlyClient, "getProviderConnection">;
type ProviderConnectionMutationClient = Pick<
  CodexlyClient,
  | "cancelProviderLogin"
  | "configureCustomProvider"
  | "logoutProvider"
  | "startOfficialProviderLogin"
>;

export function providerConnectionQueryOptions(
  client: ProviderConnectionReadClient = codexlyClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.getProviderConnection({ signal }),
    queryKey: providerConnectionQueryKey,
    refetchInterval: (query) => providerConnectionRefetchInterval(query.state.data),
  });
}

type ProviderConnectionResult = Readonly<{
  models?: ConfigureCustomProviderResponse["models"];
  status: AgentProviderConnectionStatus;
}>;

function applyProviderConnectionResult(
  queryClient: QueryClient,
  result: ProviderConnectionResult,
): void {
  queryClient.setQueryData(providerConnectionQueryKey, result.status);
  if (result.models !== undefined) queryClient.setQueryData(["models"], result.models);
}

export async function invalidateProviderDependentQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ exact: true, queryKey: ["settings"] }),
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "projects" && query.queryKey[2] === "defaults",
    }),
  ]);
}

export function startOfficialProviderLoginMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "startOfficialProviderLogin"> = codexlyClient,
) {
  return mutationOptions({
    mutationFn: () => client.startOfficialProviderLogin(),
    mutationKey: ["provider-connection", "official-login"] as const,
    onSuccess: async (result) => {
      // 连接状态直接采用 Node 响应，只刷新响应未携带的依赖数据。
      applyProviderConnectionResult(queryClient, result);
      await invalidateProviderDependentQueries(queryClient);
    },
    scope: { id: "provider-connection" },
  });
}

export function cancelProviderLoginMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "cancelProviderLogin"> = codexlyClient,
) {
  return mutationOptions({
    mutationFn: (loginId: string) => client.cancelProviderLogin(loginId),
    mutationKey: ["provider-connection", "official-login", "cancel"] as const,
    onSuccess: async (result) => {
      applyProviderConnectionResult(queryClient, result);
      await invalidateProviderDependentQueries(queryClient);
    },
    scope: { id: "provider-connection" },
  });
}

export function logoutProviderMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "logoutProvider"> = codexlyClient,
) {
  return mutationOptions({
    mutationFn: () => client.logoutProvider(),
    mutationKey: ["provider-connection", "logout"] as const,
    onSuccess: async (result) => {
      applyProviderConnectionResult(queryClient, result);
      await invalidateProviderDependentQueries(queryClient);
    },
    scope: { id: "provider-connection" },
  });
}

export async function configureCustomProvider(
  input: ConfigureCustomProviderRequest,
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "configureCustomProvider"> = codexlyClient,
): Promise<ConfigureCustomProviderResponse> {
  // Secret 只存在于当前调用栈，不作为 TanStack Mutation 变量进入缓存。
  const result = await client.configureCustomProvider(input);
  applyProviderConnectionResult(queryClient, result);
  await invalidateProviderDependentQueries(queryClient);
  return result;
}
