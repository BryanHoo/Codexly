import { SettingsMutationStatus } from "@codexly/ui/core/settings-mutation-status";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTemporaryWorkspaceSettings, chooseTemporaryWorkspaceRoot } from "@/platform/tauri/temporary-workspace-client.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField } from "./global-settings-fields.js";

const queryKey = ["temporary-workspace-settings"] as const;

export function TemporaryWorkspaceSettingsField() {
  const { t } = useTranslation("settings");
  const client = useQueryClient();
  const settings = useQuery({ queryKey, queryFn: getTemporaryWorkspaceSettings, staleTime: Infinity, retry: false });
  const change = useMutation({
    mutationFn: chooseTemporaryWorkspaceRoot,
    meta: { actionNotification: false },
    onSuccess: (value) => {
      // 取消和选择原目录均返回 null；只有实际落盘才更新缓存并提示成功。
      if (value === null) return;
      client.setQueryData(queryKey, value);
    },
  });
  const path = settings.data?.rootPath;
  return <>
    <SettingsMutationStatus mutation={{ isPending: change.isPending, isError: change.isError, isSuccess: change.isSuccess && change.data !== null }} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => change.mutate()} />
    <SettingsField label={t("general.temporaryFolder")} description={t("general.temporaryFolderDescription")}>
    <div className="flex min-w-0 max-w-md flex-col items-end gap-1">
      <div className="flex min-w-0 max-w-full items-center gap-3">
        <span className="min-w-0 truncate font-mono text-body-small text-muted-foreground" title={path}>{path ?? (settings.isError ? t("general.temporaryFolderLoadError") : t("loading"))}</span>
        <Button className="h-8 shrink-0 rounded-control bg-control px-3 hover:bg-control-hover" disabled={settings.isPending || change.isPending} onClick={() => settings.isError ? void settings.refetch() : change.mutate()} type="button" variant="ghost">
          {settings.isError ? t("common:actions.retry") : t("general.changeFolder")}
        </Button>
      </div>

    </div>
  </SettingsField>
  </>;
}
