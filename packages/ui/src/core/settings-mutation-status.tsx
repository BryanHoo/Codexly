import { SettingsSaveStatus } from "./settings-save-status.js";

/** 独立开关沿用自己的请求与禁用范围，只共享保存反馈。 */
export function SettingsMutationStatus({
  mutation,
  labels,
  onRetry,
}: Readonly<{
  mutation: Readonly<{ isPending: boolean; isError: boolean; isSuccess: boolean }>;
  labels: Readonly<{ saving: string; saved: string; saveError: string; retry: string }>;
  onRetry: () => void;
}>) {
  return (
    <SettingsSaveStatus
      status={
        mutation.isPending
          ? "saving"
          : mutation.isError
            ? "error"
            : mutation.isSuccess
              ? "saved"
              : "idle"
      }
      labels={labels}
      onRetry={onRetry}
    />
  );
}
