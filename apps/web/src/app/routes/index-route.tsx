import { createRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";

import { useProjectActions, useProjectData } from "../../features/projects/project-context.js";
import {
  appInfoQueryOptions,
  appUpdateMutationOptions,
  globalSettingsMutationOptions,
  globalSettingsQueryOptions,
  modelsQueryOptions,
} from "../../features/projects/project-queries.js";
import { loadGlobalSettingsDialog } from "../../features/settings/components/global-settings-lazy.js";
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

const LazyGlobalSettingsDialog = lazy(() =>
  loadGlobalSettingsDialog().then((module) => ({ default: module.GlobalSettingsDialog })),
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
  const globalSettingsQuery = useQuery(globalSettingsQueryOptions(client));
  const modelsQuery = useQuery(modelsQueryOptions(client));
  const globalSettingsMutation = useMutation({
    ...globalSettingsMutationOptions(client),
    onSuccess(response) {
      queryClient.setQueryData(["settings"], response);
    },
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
    <div
      className="workbench-shell h-full min-h-0 overflow-hidden bg-window"
      data-inspector-open="false"
      data-sidebar-open="true"
    >
      <ProjectSidebar
        {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
        connectionState="connected"
        onClose={() => undefined}
        onOpenSettings={(section) => {
          setGlobalSettingsSection(section);
        }}
      />
      <main className="grid min-h-0 min-w-0 place-items-center bg-content text-sm text-muted-foreground">
        {t("app.noProjects")}
      </main>
      {globalSettingsSection === null ? null : (
        <Suspense fallback={null}>
          <LazyGlobalSettingsDialog
            {...(access.status === undefined ? {} : { accessMode: access.status.mode })}
            {...(appInfoQuery.data === undefined ? {} : { appInfo: appInfoQuery.data })}
            appInfoError={appInfoQuery.error}
            initialSection={globalSettingsSection}
            apps={[]}
            error={globalSettingsQuery.error ?? modelsQuery.error}
            isPending={globalSettingsQuery.isPending || modelsQuery.isPending}
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
            onRetry={() => Promise.all([globalSettingsQuery.refetch(), modelsQuery.refetch()])}
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
    </div>
  );
}
