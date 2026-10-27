import { SettingsMutationStatus } from "@codexly/ui/core/settings-mutation-status";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrayIconVisible, setTrayIconVisible } from "@/platform/tauri/tray-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField } from "./global-settings-fields.js";

const queryKey = ["desktop-tray-icon-visible"] as const;

export function TraySettingsField() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  // 仅挂载设置或窗口重新聚焦时读取原生状态，不增加后台轮询。
  const settings = useQuery({ queryKey, queryFn: getTrayIconVisible, staleTime: 0, retry: false });
  const change = useMutation({
    mutationFn: setTrayIconVisible,
    meta: { actionNotification: false },
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (visible) => client.setQueryData(queryKey, visible),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  // 保存成功才更新开关；失败保留原值，重试使用上一次请求的目标值。
  const visible = settings.data ?? true;
  return <>
    <SettingsMutationStatus mutation={change} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => change.mutate(change.variables ?? !visible)} />
    <SettingsField label={t("general.trayIcon")} description={t("general.trayIconDescription")}>
      <div className="flex max-w-md flex-col items-end gap-1">
        <Button
          role="switch"
          aria-label={t("general.trayIcon")}
          aria-checked={visible}
          aria-busy={settings.isFetching || change.isPending}
          disabled={settings.isPending || settings.isError || change.isPending}
          className={`h-6 w-10 rounded-pill p-0.5 ${visible ? "bg-brand hover:bg-brand" : "bg-control-hover"}`}
          variant="ghost"
          type="button"
          onClick={() => change.mutate(!visible)}
        >
          <span aria-hidden="true" className={`block size-5 rounded-pill bg-brand-contrast shadow-control transition-transform motion-reduce:transition-none ${visible ? "translate-x-2" : "-translate-x-2"}`} />
        </Button>
        {settings.isError ? <div role="alert" className="text-body-small text-danger">
          {t("general.trayIconLoadError")}
          <Button variant="ghost" type="button" disabled={settings.isFetching} onClick={() => void settings.refetch()}>{t("common:actions.retry")}</Button>
        </div> : null}
      </div>
    </SettingsField>
  </>;
}
