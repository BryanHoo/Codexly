import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CodexlyClient } from "@codexly/client";
import type { MemorySettings } from "@codexly/protocol";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { SettingsField } from "./global-settings-fields.js";

export const memoriesKey = ["personalization", "memories"] as const;
export const memoryMutationScope = { id: "personalization-memories" };

export function MemorySettingField({
  field,
  client,
  settings,
}: Readonly<{
  field: keyof MemorySettings;
  client: Pick<CodexlyClient, "updateMemorySettings">;
  settings: MemorySettings | undefined;
}>) {
  const { t } = useTranslation("settings");
  const cache = useQueryClient();
  const mutation = useMutation({
    scope: memoryMutationScope,
    mutationFn: (value: boolean) => client.updateMemorySettings({ [field]: value }),
    onSuccess: (data) => cache.setQueryData(memoriesKey, data),
    meta: { actionNotification: { successMessage: false } },
  });
  const label = t(field === "enabled" ? "personalization.enabled" : "personalization.external");
  // 提交期间显示本次选择；失败只恢复当前字段，其他开关和删除入口保持稳定。
  const checked = (mutation.isPending ? mutation.variables : settings?.[field]) ?? false;
  return (
    <SettingsField
      label={label}
      description={t(
        field === "enabled"
          ? "personalization.enabledDescription"
          : "personalization.externalDescription",
      )}
    >
      <Button
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={!settings || mutation.isPending}
        className={`h-6 w-10 rounded-pill p-0.5 ${checked ? "bg-brand hover:bg-brand" : "bg-control-hover"}`}
        variant="ghost"
        type="button"
        onClick={() => {
          mutation.mutate(!checked);
        }}
      >
        <span
          className={`block size-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${checked ? "translate-x-2" : "-translate-x-2"}`}
        />
      </Button>
    </SettingsField>
  );
}
