import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import type { AcpDefaults, AgentEngine } from "@codexly/protocol";
import { AcpConfigOptions, type AcpConfigOptionsProps } from "./acp-config-options.js";
import { Button } from "./button.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { SettingsSaveStatus } from "./settings-save-status.js";

export interface AcpDefaultsClient {
  getAcpDefaults: (engine: AgentEngine, options?: { signal?: AbortSignal }) => Promise<AcpDefaults>;
  setAcpDefaultConfig: (
    engine: AgentEngine,
    id: string,
    value: string | boolean,
    options?: { idempotencyKey?: string },
  ) => Promise<AcpDefaults>;
}
export const acpDefaultSettingsLabels = {
  "zh-CN": {
    loading: "正在读取智能体设置…",
    retry: "重试",
    saving: "正在保存…",
    saved: "已保存",
    saveError: "设置保存失败",
    retained: "以下设置的原值已保留，等待复核：",
    empty: "智能体未提供可配置选项。",
  },
  en: {
    loading: "Loading agent settings…",
    retry: "Retry",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Could not save settings",
    retained: "Original values are retained for review:",
    empty: "The agent did not provide configurable options.",
  },
};
type Labels = { [K in keyof typeof acpDefaultSettingsLabels.en]: string };
interface Attempt {
  id: string;
  value: string | boolean;
  key: string;
}

/** 两端只呈现原始 ACP 控件；每次保存用完整响应替换缓存，不猜测模型依赖。 */
export function AcpDefaultSettings({
  client,
  engine,
  Field,
  Select,
  labels,
}: Readonly<{
  client: AcpDefaultsClient;
  engine: AgentEngine;
  labels: Labels;
}> &
  Pick<AcpConfigOptionsProps, "Field" | "Select">) {
  const queryClient = useQueryClient();
  const queryKey = ["acp-defaults", engine] as const;
  const scope = useMemo(
    () => ({
      pending: undefined as Promise<boolean> | undefined,
      attempt: undefined as Attempt | undefined,
    }),
    [client, engine],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => client.getAcpDefaults(engine, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: async (input: {
      engine: AgentEngine;
      client: AcpDefaultsClient;
      attempt: Attempt;
      scope: object;
    }) => {
      // 旧读取不能在保存完成后回滚整份配置；请求身份固定在点击时的引擎和客户端。
      await queryClient.cancelQueries({ queryKey: ["acp-defaults", input.engine], exact: true });
      return input.client.setAcpDefaultConfig(input.engine, input.attempt.id, input.attempt.value, {
        idempotencyKey: input.attempt.key,
      });
    },
    onSuccess: (data, input) => {
      queryClient.setQueryData(["acp-defaults", input.engine], data);
    },
    meta: { actionNotification: false },
  });
  const run = (id: string, value: string | boolean) => {
    if (scope.pending) return scope.pending;
    const previous = scope.attempt;
    const attempt =
      previous?.id === id && previous.value === value ? previous : { id, value, key: createUuid() };
    scope.attempt = attempt;
    // 同步互斥覆盖 React 尚未更新的窗口；失败重试保持同一幂等身份。
    scope.pending = mutation
      .mutateAsync({ client, engine, scope, attempt })
      .then(
        () => {
          scope.attempt = undefined;
          return true;
        },
        () => false,
      )
      .finally(() => {
        scope.pending = undefined;
      });
    return scope.pending;
  };
  const currentMutation = mutation.variables?.scope === scope;
  const error = currentMutation && mutation.isError ? mutation.error : query.error;
  const status = !currentMutation
    ? "idle"
    : mutation.isPending
      ? "saving"
      : mutation.isError
        ? "error"
        : mutation.isSuccess
          ? "saved"
          : "idle";
  const retry = () => {
    if (scope.attempt) void run(scope.attempt.id, scope.attempt.value);
    else void query.refetch();
  };
  return (
    <>
      <SettingsSaveStatus
        status={status}
        labels={labels}
        onRetry={retry}
        beforeLeave={() => scope.pending ?? Promise.resolve(status !== "error")}
      />
      {error ? (
        <div role="alert" className="mb-3 space-y-2 text-label text-danger">
          <p>{error.message}</p>
          <Button type="button" variant="ghost" onClick={retry}>
            {labels.retry}
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <>
          {query.data.unmappedLegacy.length || query.data.invalidDefaults.length ? (
            <p role="status" className="mb-3 break-words text-label text-muted-foreground">
              {labels.retained}{" "}
              {[...new Set([...query.data.unmappedLegacy, ...query.data.invalidDefaults])].join(
                ", ",
              )}
            </p>
          ) : null}
          <AcpConfigOptions
            options={query.data.configOptions}
            Field={Field}
            Select={Select}
            disabled={currentMutation && mutation.isPending}
            onChange={(id, value) => {
              void run(id, value);
            }}
          />
          {query.data.configOptions.length === 0 ? (
            <p role="status" className="text-label text-muted-foreground">
              {labels.empty}
            </p>
          ) : null}
        </>
      ) : query.isPending ? (
        <LoadingSkeleton variant="settings" label={labels.loading} className="p-0" />
      ) : null}
    </>
  );
}
