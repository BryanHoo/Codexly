import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodexlyClient } from "@codexly/client";
import type { AgentPreferences } from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField, SettingsSelect } from "./global-settings-fields.js";

const queryKey = ["personalization", "agent"] as const;
const fields = [
  { key: "webSearch", options: ["disabled", "cached", "live"] },
  { key: "modelVerbosity", options: ["", "low", "medium", "high"] },
] as const;

export function AgentPreferencesFields({
  client,
}: Readonly<{ client: Pick<CodexlyClient, "getAgentPreferences" | "updateAgentPreferences"> }>) {
  const { t } = useTranslation("settings");
  const query = useQuery({ queryKey, queryFn: () => client.getAgentPreferences() });
  return (
    <>
      {query.isError ? (
        <div role="alert">
          {t("personalization.loadError")}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : null}
      {fields.map((field) => (
        <AgentPreferenceField key={field.key} field={field} client={client} settings={query.data} />
      ))}
    </>
  );
}

function AgentPreferenceField({
  field: { key, options },
  client,
  settings,
}: Readonly<{
  field: (typeof fields)[number];
  client: Pick<CodexlyClient, "updateAgentPreferences">;
  settings: AgentPreferences | undefined;
}>) {
  const { t } = useTranslation("settings");
  const cache = useQueryClient();
  const mutation = useMutation({
    scope: { id: "personalization-agent" },
    mutationFn: (value: AgentPreferences[typeof key]) => {
      // 请求实际出队时合并最新缓存，不能用点击时的整组旧值覆盖前一项修改。
      const current = cache.getQueryData<AgentPreferences>(queryKey);
      if (!current) throw new Error("Agent preferences are not loaded");
      return client.updateAgentPreferences({ ...current, [key]: value });
    },
    onSuccess: (data) => cache.setQueryData(queryKey, data),
    meta: { actionNotification: { successMessage: false } },
  });
  // 每个字段独立持有提交状态，兄弟控件不因它的保存而禁用或改变显示值。
  const value = mutation.isPending ? mutation.variables : settings?.[key];
  return (
    <SettingsField label={t(`agent.${key}.label`)} description={t(`agent.${key}.description`)}>
      <SettingsSelect
        aria-label={t(`agent.${key}.label`)}
        disabled={!settings || mutation.isPending}
        value={value ?? ""}
        onChange={(event) => {
          mutation.mutate((event.currentTarget.value || null) as AgentPreferences[typeof key]);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`agent.${key}.${option || "default"}`)}
          </option>
        ))}
      </SettingsSelect>
    </SettingsField>
  );
}
