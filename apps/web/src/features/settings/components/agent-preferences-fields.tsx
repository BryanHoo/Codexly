import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodexlyClient } from "@codexly/client";
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
  const cache = useQueryClient();
  const query = useQuery({ queryKey, queryFn: () => client.getAgentPreferences() });
  const mutation = useMutation({
    mutationFn: (settings: NonNullable<typeof query.data>) =>
      client.updateAgentPreferences(settings),
    onSuccess: (data) => cache.setQueryData(queryKey, data),
  });
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
      {fields.map(({ key, options }) => (
        <SettingsField
          key={key}
          label={t(`agent.${key}.label`)}
          description={t(`agent.${key}.description`)}
        >
          <SettingsSelect
            aria-label={t(`agent.${key}.label`)}
            disabled={!query.data || mutation.isPending}
            value={query.data?.[key] ?? ""}
            onChange={(event) => {
              if (query.data)
                mutation.mutate({ ...query.data, [key]: event.currentTarget.value || null });
            }}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {t(`agent.${key}.${value || "default"}`)}
              </option>
            ))}
          </SettingsSelect>
        </SettingsField>
      ))}
    </>
  );
}
