import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAutostartEnabled, setAutostartEnabled } from "@/platform/tauri/autostart-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField } from "./global-settings-fields.js";

const queryKey = ["desktop-autostart"] as const;

export function AutostartSettingsField() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  // 仅在进入设置或窗口重新聚焦时查询，允许同步系统外部修改，不增加后台轮询。
  const settings = useQuery({
    queryKey,
    queryFn: getAutostartEnabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const change = useMutation({
    mutationFn: setAutostartEnabled,
    meta: { actionNotification: false },
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (enabled) => client.setQueryData(queryKey, enabled),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  const enabled = settings.data === true;
  return <SettingsField label={t("general.autostart")} description={t("general.autostartDescription")}>
    <div className="flex max-w-md flex-col items-end gap-1">
      <Button
        role="switch"
        aria-label={t("general.autostart")}
        aria-checked={enabled}
        aria-busy={settings.isFetching || change.isPending}
        disabled={settings.isPending || settings.isError || change.isPending}
        className={`h-6 w-10 rounded-pill p-0.5 ${enabled ? "bg-brand hover:bg-brand" : "bg-control-hover"}`}
        variant="ghost"
        type="button"
        onClick={() => change.mutate(!enabled)}
      >
        <span aria-hidden="true" className={`block size-5 rounded-pill bg-brand-contrast shadow-control transition-transform motion-reduce:transition-none ${enabled ? "translate-x-2" : "-translate-x-2"}`} />
      </Button>
      {settings.isError ? <div role="alert" className="text-body-small text-danger">
        {t("general.autostartLoadError")}
        <Button variant="ghost" type="button" disabled={settings.isFetching} onClick={() => void settings.refetch()}>{t("common:actions.retry")}</Button>
      </div> : null}
      {change.isError ? <span role="alert" className="text-body-small text-danger">{t("general.autostartSaveError")}</span> : null}
    </div>
  </SettingsField>;
}
