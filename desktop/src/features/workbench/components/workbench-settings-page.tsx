import { lazy, Suspense } from "react";

import { loadGlobalSettingsPage } from "../../settings/components/global-settings-lazy.js";
import { useTranslation } from "../../../i18n/i18n.js";
import type { useWorkbenchShellController } from "./workbench-shell-controller.js";

const LazyGlobalSettingsPage = lazy(() =>
  loadGlobalSettingsPage().then((module) => ({ default: module.GlobalSettingsPage })),
);

export function WorkbenchSettingsPage({
  context,
  projectToolsEnabled,
}: Readonly<{
  context: ReturnType<typeof useWorkbenchShellController>;
  projectToolsEnabled: boolean;
}>) {
  const { t } = useTranslation("settings");
  const {
    appInfoQuery,
    appUpdateMutation,
    client,
    fastModeAvailable,
    globalSettingsMutation,
    globalSettingsQuery,
    globalSettingsSection,
    models,
    modelsQuery,
    projectOpenCapabilitiesQuery,
    setGlobalSettingsSection,
  } = context;
  const agentRuntime = context.capabilities === undefined ? "pending" : context.capabilities.runtime ?? "legacy";
  if (globalSettingsSection === null) return null;

  return (
    <Suspense fallback={<main className="grid h-full place-items-center text-body-small text-muted-foreground" role="status">{t("loading")}</main>}>
      <LazyGlobalSettingsPage
            key={agentRuntime}
        agentRuntime={agentRuntime}
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
        appInfoError={appInfoQuery.error}
        apps={projectToolsEnabled ? (projectOpenCapabilitiesQuery.data?.apps ?? []) : []}
        error={globalSettingsQuery.error ?? (agentRuntime === "legacy" ? modelsQuery.error : null) ?? (projectToolsEnabled ? projectOpenCapabilitiesQuery.error : null)}
        isPending={globalSettingsQuery.isPending || (agentRuntime === "legacy" && modelsQuery.isLoading) || (projectToolsEnabled && projectOpenCapabilitiesQuery.isPending)}
        fastModeAvailable={fastModeAvailable}
        initialSection={globalSettingsSection}
        isAppInfoPending={appInfoQuery.isPending}
        models={models}
        onClose={() => {
          const triggerId = globalSettingsSection === "about"
            ? "#global-settings-about-trigger"
            : "#global-settings-trigger";
          setGlobalSettingsSection(null);
          requestAnimationFrame(() => {
            document.querySelector<HTMLButtonElement>(triggerId)?.focus();
          });
        }}
        onRetry={() => Promise.all([
          globalSettingsQuery.refetch(),
          ...(agentRuntime === "legacy" ? [modelsQuery.refetch()] : []),
          ...(projectToolsEnabled ? [projectOpenCapabilitiesQuery.refetch()] : []),
        ])}
        onRetryAppInfo={() => appInfoQuery.refetch()}
        onExportDiagnostics={() => client.exportDiagnostics()}
        onSave={(settings, baseline = settings, idempotencyKey) => globalSettingsMutation.mutateAsync({settings,baseline,...(idempotencyKey === undefined ? {} : {idempotencyKey})}).then(() => undefined)}
        onUpdate={(version, onProgress) => appUpdateMutation.mutateAsync({ onProgress, version })}
        {...(globalSettingsQuery.data === undefined ? {} : { settings: globalSettingsQuery.data.settings })}
      />
    </Suspense>
  );
}
