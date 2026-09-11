import { lazy, Suspense } from "react";
import { loadGlobalSettingsPage } from "../../settings/components/global-settings-lazy.js";
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
  const {
    client,
    access,
    appInfoQuery,
    appUpdateMutation,
    appUpdateProgressQuery,
    globalSettingsMutation,
    globalSettingsSection,
    globalSettingsQuery,
    fastModeAvailable,
    models,
    modelsQuery,
    projectOpenCapabilitiesQuery,
    setGlobalSettingsSection,
  } = context;
  return (
    <>
      {globalSettingsSection === null ? null : (
        <Suspense fallback={null}>
          <LazyGlobalSettingsPage
            client={client}
            {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            apps={projectToolsEnabled ? (projectOpenCapabilitiesQuery.data?.apps ?? []) : []}
            error={
              globalSettingsQuery.error ??
              modelsQuery.error ??
              (projectToolsEnabled ? projectOpenCapabilitiesQuery.error : null)
            }
            isPending={
              globalSettingsQuery.isPending ||
              modelsQuery.isPending ||
              (projectToolsEnabled && projectOpenCapabilitiesQuery.isPending)
            }
            fastModeAvailable={fastModeAvailable}
            initialSection={globalSettingsSection}
            isAppInfoPending={appInfoQuery.isPending}
            isAppUpdatePending={appUpdateMutation.isPending}
            {...(appUpdateProgressQuery.data?.progress === null ||
            appUpdateProgressQuery.data?.progress === undefined
              ? {}
              : { appUpdateProgress: appUpdateProgressQuery.data.progress })}
            models={models}
            onClose={() => {
              const triggerId =
                globalSettingsSection === "about"
                  ? "#global-settings-about-trigger"
                  : "#global-settings-trigger";
              setGlobalSettingsSection(null);
              requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>(triggerId)?.focus();
              });
            }}
            onLogoutAccess={access.logout}
            onRetry={() =>
              Promise.all([
                globalSettingsQuery.refetch(),
                modelsQuery.refetch(),
                ...(projectToolsEnabled ? [projectOpenCapabilitiesQuery.refetch()] : []),
              ])
            }
            onRetryAppInfo={() => appInfoQuery.refetch()}
            onSave={(settings) =>
              globalSettingsMutation.mutateAsync(settings).then(() => undefined)
            }
            onUpdate={(version) => appUpdateMutation.mutateAsync(version).then(() => undefined)}
            {...(globalSettingsQuery.data === undefined
              ? {}
              : { settings: globalSettingsQuery.data.settings })}
          />
        </Suspense>
      )}
    </>
  );
}
