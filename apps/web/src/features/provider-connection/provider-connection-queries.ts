import type { CodeAgentClient } from "@code-agent/client";
import type {
  AgentProviderConnectionStatus,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
} from "@code-agent/protocol";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { codeAgentClient } from "../projects/project-query-contracts.js";

export const providerConnectionQueryKey = ["provider-connection"] as const;

export function providerConnectionRefetchInterval(
  status: AgentProviderConnectionStatus | undefined,
): number | false {
  return status?.state === "pending" ? 1_000 : false;
}

type ProviderConnectionReadClient = Pick<CodeAgentClient, "getProviderConnection">;
type ProviderConnectionMutationClient = Pick<
  CodeAgentClient,
  | "cancelProviderLogin"
  | "configureCustomProvider"
  | "logoutProvider"
  | "startOfficialProviderLogin"
>;

export function providerConnectionQueryOptions(
  client: ProviderConnectionReadClient = codeAgentClient,
) {
  return queryOptions({
    queryFn: ({ signal }) => client.getProviderConnection({ signal }),
    queryKey: providerConnectionQueryKey,
    refetchInterval: (query) => providerConnectionRefetchInterval(query.state.data),
  });
}

export async function invalidateProviderConnectionQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ exact: true, queryKey: providerConnectionQueryKey }),
    queryClient.invalidateQueries({ exact: true, queryKey: ["models"] }),
    queryClient.invalidateQueries({ exact: true, queryKey: ["settings"] }),
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "projects" && query.queryKey[2] === "defaults",
    }),
  ]);
}

export function startOfficialProviderLoginMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "startOfficialProviderLogin"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: () => client.startOfficialProviderLogin(),
    mutationKey: ["provider-connection", "official-login"] as const,
    onSuccess: () => invalidateProviderConnectionQueries(queryClient),
    scope: { id: "provider-connection" },
  });
}

export function cancelProviderLoginMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "cancelProviderLogin"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: (loginId: string) => client.cancelProviderLogin(loginId),
    mutationKey: ["provider-connection", "official-login", "cancel"] as const,
    onSuccess: () => invalidateProviderConnectionQueries(queryClient),
    scope: { id: "provider-connection" },
  });
}

export function logoutProviderMutationOptions(
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "logoutProvider"> = codeAgentClient,
) {
  return mutationOptions({
    mutationFn: () => client.logoutProvider(),
    mutationKey: ["provider-connection", "logout"] as const,
    onSuccess: () => invalidateProviderConnectionQueries(queryClient),
    scope: { id: "provider-connection" },
  });
}

export async function configureCustomProvider(
  input: ConfigureCustomProviderRequest,
  queryClient: QueryClient,
  client: Pick<ProviderConnectionMutationClient, "configureCustomProvider"> = codeAgentClient,
): Promise<ConfigureCustomProviderResponse> {
  // Secret 只存在于当前调用栈，不作为 TanStack Mutation 变量进入缓存。
  const result = await client.configureCustomProvider(input);
  await invalidateProviderConnectionQueries(queryClient);
  return result;
}
