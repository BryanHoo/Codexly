import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "sonner";

import { ProjectProvider } from "../features/projects/project-context.js";
import { TaskActivityRestore } from "../features/conversation/runtime/task-activity-restore.js";
import { createActionMutationCache } from "../features/notifications/action-notifications.js";
import { ProviderConnectionGate } from "../features/provider-connection/components/provider-connection-gate.js";
import { CodexRuntimeGate } from "../features/runtime/components/codex-runtime-gate.js";
import { ComposerDraftProvider } from "../features/workbench/composer-draft-context.js";
import { ProjectDraftProvider } from "../features/workbench/project-draft-context.js";
import { I18nextProvider, i18n } from "../i18n/i18n.js";
import { TooltipProvider } from "../shared/components/core/tooltip.js";
import {
  getApplicationDetailViewUpdateGate,
  installApplicationSuspensionEffects,
} from "../shared/lifecycle/application-visibility.js";
import { useTranslation } from "../i18n/i18n.js";
import { installInactiveSnapshotMemoryLimit } from "./snapshot-memory.js";

export const DEFAULT_QUERY_GC_TIME_MS = 2 * 60_000;

export function createAppQueryClient() {
  const queryClient = new QueryClient({
    mutationCache: createActionMutationCache(),
    defaultOptions: {
      queries: {
        gcTime: DEFAULT_QUERY_GC_TIME_MS,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
  installInactiveSnapshotMemoryLimit(queryClient);
  return queryClient;
}

const queryClient = createAppQueryClient();

type AppProvidersProps = Readonly<{
  children: ReactNode;
}>;

function ApplicationSuspensionEffects() {
  useEffect(() => {
    const dispose = installApplicationSuspensionEffects(getApplicationDetailViewUpdateGate(), {
      setAnimationsSuspended(suspended) {
        document.documentElement.toggleAttribute("data-detail-view-suspended", suspended);
      },
      setPollingActive(active) {
        focusManager.setFocused(active);
      },
    });
    return () => {
      dispose();
      document.documentElement.removeAttribute("data-detail-view-suspended");
      focusManager.setFocused(undefined);
    };
  }, []);
  return null;
}

function AppProviderContent({ children }: AppProvidersProps) {
  const { t } = useTranslation("common");
  return (
    <>
      <CodexRuntimeGate>
        <ProviderConnectionGate>
          <ProjectProvider>
            <TaskActivityRestore />
            <ProjectDraftProvider>
              <ComposerDraftProvider>{children}</ComposerDraftProvider>
            </ProjectDraftProvider>
          </ProjectProvider>
        </ProviderConnectionGate>
      </CodexRuntimeGate>
      <Toaster
        containerAriaLabel={t("app.notificationRegion")}
        duration={5_000}
        position="top-center"
        richColors
        theme="system"
      />
    </>
  );
}

export function AppProviders({ children }: AppProvidersProps) {
  // SPA 生命周期内复用同一个 QueryClient，避免导航时丢失服务端状态缓存。
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <ApplicationSuspensionEffects />
          <AppProviderContent>{children}</AppProviderContent>
        </QueryClientProvider>
      </TooltipProvider>
    </I18nextProvider>
  );
}
