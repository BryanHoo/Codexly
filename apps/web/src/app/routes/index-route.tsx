import { useApplicationSettings } from "@codexly/ui/core/use-application-settings";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";

import { useProjectActions, useProjectData } from "../../features/projects/project-context.js";
import {
  appInfoQueryOptions,
  refreshAppInfo,
  appUpdateMutationOptions,
  appUpdateProgressQueryOptions,
  modelsQueryOptions,
  capabilitiesQueryOptions,
} from "../../features/projects/project-queries.js";
import { loadGlobalSettingsPage } from "../../features/settings/components/global-settings-lazy.js";
import { useTranslation } from "../../i18n/i18n.js";
import { useAccess } from "../../features/access/access-context.js";
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
import { WorkbenchBackground } from "../../features/workbench/components/workbench-background.js";

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
  const access = useAccess();
  const { client, error, isPending, projects } = useProjectData();
  const { retry } = useProjectActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appInfoQuery = useQuery(appInfoQueryOptions(client));
  const appUpdateMutation = useMutation({
    ...appUpdateMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["app-info"], response);
    },
  });
  const appUpdateProgressQuery = useQuery(
    appUpdateProgressQueryOptions(client, appUpdateMutation.isPending),
  );
  const capabilitiesQuery = useQuery(capabilitiesQueryOptions(client));
  const agentRuntime =
    capabilitiesQuery.data === undefined ? "pending" : (capabilitiesQuery.data.runtime ?? "legacy");
  const codexEnabled = useSelectedEngines()?.includes("codex") ?? true;
  const { globalSettingsQuery, globalSettingsMutation } = useApplicationSettings(
    client,
    codexEnabled ? "codex" : "claude",
    agentRuntime,
  );
  const modelsQuery = useQuery({
    ...modelsQueryOptions(client, codexEnabled ? "codex" : "claude"),
    enabled: agentRuntime === "legacy",
  });
  const [globalSettingsSection, setGlobalSettingsSection] = useState<SidebarSettingsSection | null>(
    null,
  );
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
    <WorkbenchBackground>
      <div
        hidden={globalSettingsSection !== null}
        className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
        data-inspector-open="false"
        data-sidebar-open="true"
      >
        <ProjectSidebar
          appUpdate={{
            isUpdatePending: appUpdateMutation.isPending,
            onUpdate: (version) => appUpdateMutation.mutateAsync(version).then(() => undefined),
            ...(appUpdateMutation.isPending && appUpdateProgressQuery.data?.progress
              ? { updatePercentage: appUpdateProgressQuery.data.progress.percent }
              : {}),
          }}
          {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
          connectionState="connected"
          onClose={() => undefined}
          onOpenFile={() => undefined}
          onOpenSettings={(section) => {
            setGlobalSettingsSection(section);
          }}
        />
        <main className="grid min-h-0 min-w-0 place-items-center bg-content text-sm text-muted-foreground">
          {t("app.noProjects")}
        </main>
      </div>
      {globalSettingsSection === null ? null : (
        <Suspense fallback={null}>
          <LazyGlobalSettingsPage
            key={agentRuntime}
            agentRuntime={agentRuntime}
            client={client}
            {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            initialSection={globalSettingsSection}
            apps={[]}
            error={
              capabilitiesQuery.error ??
              globalSettingsQuery.error ??
              (agentRuntime === "legacy" ? modelsQuery.error : null)
            }
            isPending={
              globalSettingsQuery.isPending || (agentRuntime === "legacy" && modelsQuery.isLoading)
            }
            isAppInfoPending={appInfoQuery.isPending}
            isAppUpdatePending={appUpdateMutation.isPending}
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
            onLogoutAccess={access.logout}
            onRetry={() =>
              Promise.all([
                capabilitiesQuery.refetch(),
                ...(agentRuntime === "pending" ? [] : [globalSettingsQuery.refetch()]),
                ...(agentRuntime === "legacy" ? [modelsQuery.refetch()] : []),
              ])
            }
            onRetryAppInfo={() => refreshAppInfo(queryClient, client)}
            onSave={(settings, baseline = settings, idempotencyKey) =>
              globalSettingsMutation
                .mutateAsync({
                  settings,
                  baseline,
                  ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
                })
                .then(() => undefined)
            }
            onUpdate={(version) => appUpdateMutation.mutateAsync(version).then(() => undefined)}
            {...(globalSettingsQuery.data === undefined
              ? {}
              : { settings: globalSettingsQuery.data.settings })}
          />
        </Suspense>
      )}
    </WorkbenchBackground>
  );
}
