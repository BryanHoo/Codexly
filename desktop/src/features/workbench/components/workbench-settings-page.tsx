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
  if (globalSettingsSection === null) return null;

  return (
    <Suspense fallback={<main className="grid h-full place-items-center text-body-small text-muted-foreground" role="status">{t("loading")}</main>}>
      <LazyGlobalSettingsPage
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
        appInfoError={appInfoQuery.error}
        apps={projectToolsEnabled ? (projectOpenCapabilitiesQuery.data?.apps ?? []) : []}
        error={globalSettingsQuery.error ?? modelsQuery.error ?? (projectToolsEnabled ? projectOpenCapabilitiesQuery.error : null)}
        isPending={globalSettingsQuery.isPending || modelsQuery.isPending || (projectToolsEnabled && projectOpenCapabilitiesQuery.isPending)}
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
          modelsQuery.refetch(),
          ...(projectToolsEnabled ? [projectOpenCapabilitiesQuery.refetch()] : []),
        ])}
        onRetryAppInfo={() => appInfoQuery.refetch()}
        onExportDiagnostics={() => client.exportDiagnostics()}
        onSave={(settings) => globalSettingsMutation.mutateAsync(settings).then(() => undefined)}
        onUpdate={(version, onProgress) => appUpdateMutation.mutateAsync({ onProgress, version })}
        {...(globalSettingsQuery.data === undefined ? {} : { settings: globalSettingsQuery.data.settings })}
      />
    </Suspense>
  );
}
