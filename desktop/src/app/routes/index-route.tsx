import { useApplicationSettings } from "@codexly/ui/core/use-application-settings";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, lazy, Suspense, useEffect, useState } from "react";

import { useProjectActions, useProjectData } from "../../features/projects/project-context.js";
import {
  appInfoQueryOptions,
  appUpdateMutationOptions,
  modelsQueryOptions,
  capabilitiesQueryOptions,
} from "../../features/projects/project-queries.js";
import { loadGlobalSettingsPage } from "../../features/settings/components/global-settings-lazy.js";
import { useTranslation } from "../../i18n/i18n.js";
import { RuntimeUnavailable } from "../../shared/components/core/runtime-unavailable.js";
import {
  ProjectSidebar,
  type SidebarSettingsSection,
} from "../../features/workbench/components/project-sidebar.js";
import {
  getProjectSidebarPreferenceStorage,
  readExpandedProjectIds,
  resolveInitialProjectId,
} from "../../features/workbench/project-sidebar-preferences.js";
import { rootRoute } from "./root-route.js";

const LazyGlobalSettingsPage = lazy(() =>
  loadGlobalSettingsPage().then((module) => ({ default: module.GlobalSettingsPage })),
);

export const indexRoute = createRoute({
  component: IndexPage,
  getParentRoute: () => rootRoute,
  path: "/",
});

function IndexPage() {
  const { t } = useTranslation("common");
  const { client, error, isPending, projects } = useProjectData();
  const { retry } = useProjectActions();
  const navigate = useNavigate();
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation(appUpdateMutationOptions(client));
  const engines = useSelectedEngines();
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const agentRuntime = capabilitiesQuery.data === undefined ? "pending" : capabilitiesQuery.data.runtime ?? "legacy";
  const codexEnabled = engines?.includes("codex") ?? true;
  const engineEnabled = engines === undefined || engines.length > 0;
  const {globalSettingsQuery,globalSettingsMutation} = useApplicationSettings(client,codexEnabled ? "codex" : "claude",agentRuntime);
  const modelsQuery = useQuery({ ...modelsQueryOptions(client, codexEnabled ? "codex" : "claude"), enabled: engineEnabled && agentRuntime === "legacy" });
  const [globalSettingsSection, setGlobalSettingsSection] = useState<SidebarSettingsSection | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [initialSavedExpandedProjectIds] = useState(() =>
    readExpandedProjectIds(getProjectSidebarPreferenceStorage()),
  );
  const initialProjectId = resolveInitialProjectId(
    projects.map((project) => project.id),
    initialSavedExpandedProjectIds,
  );

  useEffect(() => {
    if (initialProjectId !== undefined) {
      void navigate({
        params: { projectId: initialProjectId },
        replace: true,
        to: "/p/$projectId",
      });
      return;
    }
    if (!isPending && projects.length === 0) {
      void navigate({ replace: true, to: "/temporary" });
    }
  }, [initialProjectId, isPending, navigate, projects.length]);

  if (error !== null) {
    return (
      <main className="flex h-full min-h-0">
        <RuntimeUnavailable onRetry={() => void retry()} />
      </main>
    );
  }
  if (isPending || initialProjectId !== undefined || projects.length === 0) {
    return (
      <main className="grid h-full place-items-center text-sm text-muted-foreground">
        {t("app.loadingProjects")}
      </main>
    );
  }
  return (
    <>
      <Activity mode={globalSettingsSection === null ? "visible" : "hidden"}>
        <div
          className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
          data-inspector-open="false"
          data-sidebar-open={sidebarOpen}
        >
          <ProjectSidebar
            isUpdatePending={appUpdateMutation.isPending}
            onUpdate={(version, onProgress) => appUpdateMutation.mutateAsync({ version, onProgress })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            onClose={() => undefined}
            onOpenFile={() => undefined}
            onOpenSettings={(section) => {
              setGlobalSettingsSection(section);
            }}
            onPanelShortcut={(panel) => {
              if (panel === "search") setSidebarOpen(true);
              else if (panel === "sidebar") setSidebarOpen((open) => !open);
            }}
          />
          <main className="grid min-h-0 min-w-0 place-items-center bg-content text-sm text-muted-foreground">
            {t("app.noProjects")}
          </main>
        </div>
      </Activity>
      {globalSettingsSection === null ? null : (
        <Suspense
          fallback={
            <main
              className="grid h-full place-items-center text-body-small text-muted-foreground"
              role="status"
            >
              {t("settings:loading")}
            </main>
          }
        >
          <LazyGlobalSettingsPage
            key={agentRuntime} agentRuntime={agentRuntime}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            initialSection={globalSettingsSection}
            apps={[]}
            error={capabilitiesQuery.error ?? globalSettingsQuery.error ?? (agentRuntime === "legacy" ? modelsQuery.error : null)}
            isPending={globalSettingsQuery.isPending || (agentRuntime === "legacy" && modelsQuery.isLoading)}
            isAppInfoPending={appInfoQuery.isPending}
            models={modelsQuery.data?.data ?? []}
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
            onRetry={() => Promise.all([capabilitiesQuery.refetch(), ...(agentRuntime === "pending" ? [] : [globalSettingsQuery.refetch()]), ...(agentRuntime === "legacy" ? [modelsQuery.refetch()] : [])])}
            onRetryAppInfo={() => appInfoQuery.refetch()}
            onExportDiagnostics={() => client.exportDiagnostics()}
            onSave={(settings, baseline = settings, idempotencyKey) =>
              globalSettingsMutation.mutateAsync({settings,baseline,...(idempotencyKey === undefined ? {} : {idempotencyKey})}).then(() => undefined)
            }
            onUpdate={(version, onProgress) =>
              appUpdateMutation.mutateAsync({ onProgress, version })
            }
            {...(globalSettingsQuery.data === undefined
              ? {}
              : { settings: globalSettingsQuery.data.settings })}
          />
        </Suspense>
      )}
    </>
  );
}
