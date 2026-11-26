import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApplicationPreferences } from "@codexly/protocol/application-preferences";
import {
  applicationSettingsQuery,
  applicationSettingsMutation,
  type ApplicationSettingsClient,
  type ApplicationSettingsRuntime,
} from "@codexly/frontend-core/engine-settings-query";
import type { AgentEngine } from "@codexly/protocol";

type Mutation<T extends { readonly model: string }> = ReturnType<
  typeof applicationSettingsMutation<T>
>;
export interface ApplicationSettingsState<T extends { readonly model: string }> {
  // 只公布页面实际消费的状态，避免跨包声明暴露 Query 的内部构建路径和实现类型。
  globalSettingsQuery: {
    data: { settings: T | ApplicationPreferences } | undefined;
    error: Error | null;
    isPending: boolean;
    isLoading: boolean;
    refetch: () => Promise<unknown>;
  };
  globalSettingsMutation: {
    mutateAsync: (
      input: Parameters<Mutation<T>["mutationFn"]>[0],
    ) => Promise<Awaited<ReturnType<Mutation<T>["mutationFn"]>>>;
    isPending: boolean;
    error: Error | null;
  };
}

/** 统一双端设置路由和缓存更新；应用偏好变化不能刷新聊天默认值或历史快照。 */
export function useApplicationSettings<T extends { readonly model: string }>(
  client: ApplicationSettingsClient<T>,
  engine: AgentEngine,
  runtime: ApplicationSettingsRuntime,
  afterLegacySave?: (changedFields: readonly string[] | undefined) => Promise<void>,
): ApplicationSettingsState<T> {
  const cache = useQueryClient();
  const options = applicationSettingsQuery(client, engine, runtime);
  const globalSettingsQuery = useQuery(options);
  const globalSettingsMutation = useMutation({
    ...applicationSettingsMutation(client, engine, runtime),
    onMutate: async () => {
      // 持久化前取消在途读取，避免较晚返回的旧快照覆盖保存结果。
      await cache.cancelQueries({ queryKey: options.queryKey, exact: true });
    },
    onSuccess: async (result) => {
      if (result.runtime === "acp") {
        if (!result.unchanged) cache.setQueryData(["application-preferences"], result.response);
      } else {
        cache.setQueryData(
          result.engine === "codex" ? ["settings"] : ["settings", "claude"],
          result.response,
        );
        await afterLegacySave?.(result.response.changedFields);
      }
    },
  });
  return { globalSettingsQuery, globalSettingsMutation };
}
