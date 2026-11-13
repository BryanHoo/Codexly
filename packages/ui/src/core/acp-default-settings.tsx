import { useMemo, useState } from "react";
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
    empty: "智能体未提供可配置选项。",
  },
  en: {
    loading: "Loading agent settings…",
    retry: "Retry",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Could not save settings",
    empty: "The agent did not provide configurable options.",
  },
};
type Labels = { [K in keyof typeof acpDefaultSettingsLabels.en]: string };
interface Attempt {
  id: string;
  value: string | boolean;
  key: string;
}

/** 两端只呈现原始 ACP 控件；失焦后逐项保存，用完整响应更新依赖选项；原始迁移标识只保留在宿主。 */
export function AcpDefaultSettings({
  client,
  engine,
  Field,
  Select,
  labels,
  language,
}: Readonly<{
  client: AcpDefaultsClient;
  engine: AgentEngine;
  labels: Labels;
  language?: string;
}> &
  Pick<AcpConfigOptionsProps, "Field" | "Select">) {
  const queryClient = useQueryClient();
  const queryKey = ["acp-defaults", engine] as const;
  const scope = useMemo(
    () => ({
      pending: undefined as Promise<boolean> | undefined,
      attempt: undefined as Attempt | undefined,
      draft: undefined as { id: string; value: string | boolean } | undefined,
    }),
    [client, engine],
  );
  const [draft, setDraft] = useState<{ scope: object; id: string; value: string | boolean }>();
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
    scope.draft = undefined;
    // 同步互斥覆盖 React 尚未更新的窗口；失败重试保持同一幂等身份。
    scope.pending = mutation
      .mutateAsync({ client, engine, scope, attempt })
      .then(
        () => {
          scope.attempt = undefined;
          setDraft((current) => (current?.scope === scope ? undefined : current));
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
        beforeLeave={() =>
          scope.pending ??
          (scope.draft
            ? run(scope.draft.id, scope.draft.value)
            : Promise.resolve(status !== "error"))
        }
      />
      {error ? (
        <div role="alert" className="mb-3 space-y-2 text-label text-danger">
          <p>{labels.saveError}</p>
          <Button type="button" variant="ghost" onClick={retry}>
            {labels.retry}
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <>
          <AcpConfigOptions
            options={query.data.configOptions.map((option) =>
              draft?.scope === scope && draft.id === option.id
                ? { ...option, currentValue: draft.value }
                : option,
            )}
            language={language ?? (labels === acpDefaultSettingsLabels["zh-CN"] ? "zh-CN" : "en")}
            settingsControls
            onCommit={(id) => {
              const current = scope.draft;
              if (current?.id === id) void run(current.id, current.value);
            }}
            Field={Field}
            Select={Select}
            disabled={currentMutation && mutation.isPending}
            onChange={(id, value) => {
              if (scope.pending) return;
              // 新编辑取代失败的旧提交；回到已保存值后，重试不能再次写入已放弃的值。
              scope.attempt = undefined;
              mutation.reset();
              const baseline = query.data.configOptions.find(
                (option) => option.id === id,
              )?.currentValue;
              scope.draft = baseline === value ? undefined : { id, value };
              setDraft(scope.draft ? { scope, ...scope.draft } : undefined);
            }}
          />
          {query.data.configOptions.length === 0 ? (
            <p role="status" className="text-label text-muted-foreground">
              {labels.empty}
            </p>
          ) : null}
        </>
      ) : query.isPending ? (
        <LoadingSkeleton variant="settings-fields" label={labels.loading} className="px-0 py-1" />
      ) : null}
    </>
  );
}
