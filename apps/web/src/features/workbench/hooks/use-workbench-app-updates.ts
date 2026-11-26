import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appInfoQueryOptions,
  appUpdateMutationOptions,
  appUpdateProgressQueryOptions,
} from "../../projects/project-queries.js";

type Client = Parameters<typeof appInfoQueryOptions>[0];
/** 应用更新独立于聊天引擎，避免运行时配置变化重新定义更新状态。 */
export function useWorkbenchAppUpdates(client: Client) {
  const queryClient = useQueryClient();
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation({
    ...appUpdateMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["app-info"], response);
    },
  });
  const appUpdateProgressQuery = useQuery(
    appUpdateProgressQueryOptions(client, appUpdateMutation.isPending),
  );
  return { appInfoQuery, appUpdateMutation, appUpdateProgressQuery };
}
