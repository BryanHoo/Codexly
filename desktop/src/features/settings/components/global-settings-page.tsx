import { ProjectDataContext } from "../../projects/project-context-state.js";
import { DefaultGenerationSettings } from "@codexly/ui/core/default-generation-settings";
import { nativeClient } from "../../projects/project-queries.js";
import { useSettingsAutosave } from "@codexly/ui/core/use-settings-autosave";
import { SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
import { isClaudeSettingsSection } from "@codexly/frontend-core/settings-navigation";
import type {
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  AppUpdateInstallProgress,
  ExportDiagnosticsResponse,
  ProjectOpenApp,
} from "@/protocol/index.js";
import { Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { getNotificationPreference } from "../notification-preference.js";
import type { ThemePreference } from "../theme-preference.js";
import type { SettingsSectionId } from "./global-settings-fields.js";
import {
  createFallbackSettings,
  readInitialTheme,
} from "./global-settings-model.js";
import {
  createGlobalSettingsSaveQueue,
  SETTINGS_INPUT_DEBOUNCE_MS,
} from "./global-settings-save.js";
import { UsageStatistics, SavedPromptsSettings, ClaudeSettingsPanel, GlobalSettingsAbout, ProviderConnectionPanel, GlobalSettingsPets, AgentSettingsPanel, GeneralSettingsPanel, PersonalizationSettingsPanel, CommitSettingsPanel } from "./settings-section-loaders.js";
import { applyBrowserSettingsChanges } from "./browser-settings-apply.js";
import { SettingsPageFrame } from "./settings-page-frame.js";
export { resolveGlobalSettingsModel } from "./global-settings-model.js";

type GlobalSettingsPageProps = Readonly<{
  appInfo?: AppInfoResponse;
  appInfoError?: Error | null;
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  fastModeAvailable?: boolean;
  initialSection?: SettingsSectionId;
  isAppInfoPending?: boolean;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onRetry: () => unknown;
  onRetryAppInfo?: () => unknown;
  onExportDiagnostics?: () => Promise<ExportDiagnosticsResponse>;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  onUpdate?: (
    version: string,
    onProgress: (progress: AppUpdateInstallProgress) => void,
  ) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;



export function GlobalSettingsPage({
  appInfo,
  appInfoError = null,
  apps,
  error,
  fastModeAvailable = false,
  initialSection = "appearance",
  isAppInfoPending = false,
  isPending,
  models,
  onClose,
  onRetry,
  onRetryAppInfo = () => undefined,
  onExportDiagnostics = () => Promise.resolve({ status: "cancelled" }),
  onSave,
  onUpdate = () => Promise.resolve(),
  settings,
}: GlobalSettingsPageProps) {
  const { t } = useTranslation("settings");
  const projectData = useContext(ProjectDataContext);
  const getGenerationModels = useCallback(async (engine: "codex" | "claude") =>
    engine === "codex" ? models : (await nativeClient.getEngineProfile(engine)).models.data, [models]);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const mounted = useRef(true);
  const closing = useRef(false);
  const browserDraft = useRef({ theme, language, notificationsEnabled });
  const browserSave = useSettingsAutosave<typeof browserDraft.current>(async (next) => {
    await applyBrowserSettingsChanges(next);
  });
  const updateBrowser = (patch: Partial<typeof browserDraft.current>) => {
    browserDraft.current = { ...browserDraft.current, ...patch };
    setTheme(browserDraft.current.theme);
    setLanguage(browserDraft.current.language);
    setNotificationsEnabled(browserDraft.current.notificationsEnabled);
    browserSave.queue.save(browserDraft.current);
  };
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const draftRef = useRef(draft);
  const hasLocalChangesRef = useRef(false);
  const saveQueueRef = useRef<ReturnType<typeof createGlobalSettingsSaveQueue> | null>(null);
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createGlobalSettingsSaveQueue((next) => onSaveRef.current(next), (status) => {
      if (mounted.current) setSaveStatus(status);
    });
    if (settings !== undefined) saveQueueRef.current.reset(settings);
  }
  const saveQueue = saveQueueRef.current;
  useEffect(() => {
    if (settings !== undefined && !hasLocalChangesRef.current) {
      draftRef.current = settings;
      setDraft(settings);
      saveQueue.reset(settings);
    }
  }, [saveQueue, settings]);

  const updateDraft = (
    update: (current: AgentGlobalSettings) => AgentGlobalSettings,
    debounce = false,
  ) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    hasLocalChangesRef.current = true;
    setDraft(next);
    if (debounce) {
      saveQueue.schedule(next, SETTINGS_INPUT_DEBOUNCE_MS);
    } else {
      saveQueue.save(next);
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (hasLocalChangesRef.current) void saveQueue.flush(draftRef.current);
    };
  }, [saveQueue]);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    // 返回前等待最新设置落盘；失败时保留当前页面，供用户重试。
    void Promise.all([
      saveQueue.flush(hasLocalChangesRef.current ? draftRef.current : undefined),
      browserSave.queue.flush(),
    ]).then(([backendSaved, browserSaved]) => {
      closing.current = false;
      if (backendSaved && browserSaved) onClose();
    });
  };

  return (
    <SettingsPageFrame
      activeSection={activeSection}
      onBack={close}
      onSectionChange={setActiveSection}
    >
      {activeSection === "appearance" || activeSection === "pets" || activeSection === "agent" || activeSection === "git" ? <SettingsSaveStatus status={saveStatus} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => saveQueue.save(draftRef.current)} /> : null}
      {activeSection === "appearance" ? <SettingsSaveStatus status={browserSave.status} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => { void browserSave.queue.retry(); }} /> : null}
      <Suspense fallback={<div className="grid min-h-40 place-items-center text-body-small text-muted-foreground" role="status">{t("loading")}</div>}>
      {activeSection === "about" ? <GlobalSettingsAbout
        activeSection={activeSection}
        {...(appInfo === undefined ? {} : { appInfo })}
        error={appInfoError}
        isPending={isAppInfoPending}
        onRetry={onRetryAppInfo}
        onExportDiagnostics={onExportDiagnostics}
        onUpdate={onUpdate}
      /> : null}

      {activeSection === "usage" ? <UsageStatistics client={nativeClient} language={language} /> : activeSection === "prompts" ? <SavedPromptsSettings language={language} projects={projectData?.projects} projectsUnavailable={!projectData || projectData.isPending || !!projectData.error} /> : isClaudeSettingsSection(activeSection) ? <ClaudeSettingsPanel section={activeSection} /> : activeSection === "provider" ? (
        <section id="settings-panel-provider">
          <h1 className="mb-6 text-xl font-semibold">{t("sections.provider")}</h1>
          <ProviderConnectionPanel autoSave />
        </section>
      ) : activeSection === "personalization" ? (
        <PersonalizationSettingsPanel />
      ) : activeSection === "git" ? (
        <section id="settings-panel-git" className="space-y-6">
          <h1 className="text-xl font-semibold">{t("sections.git")}</h1>
          {
          error !== null ? <div role="alert" className="text-body-small text-danger">
            <p>{t("errors.load")}</p>
            <Button variant="ghost" onClick={() => void onRetry()}>{t("common:actions.retry")}</Button>
          </div> : isPending || settings === undefined ? <p role="status" className="text-body-small text-muted-foreground">{t("loading")}</p> : (
            <>
<DefaultGenerationSettings settings={draft} language={language} getModels={getGenerationModels} onChange={(patch) => updateDraft((current) => ({ ...current, ...patch }))} />
<CommitSettingsPanel settings={draft} onChange={updateDraft} onFlush={() => { void saveQueue.flush(draftRef.current); }} />
</>
          )}
        </section>
      ) : activeSection === "about" ? null : error !== null ? (
        <div
          className="flex min-h-40 flex-col items-center justify-center gap-3"
          role="alert"
        >
          <p className="text-body-small text-danger">{t("errors.load")}</p>
          <Button
            variant="ghost"
            className="h-8 rounded-control bg-control px-3 text-body-small font-medium hover:bg-control-hover"
            onClick={() => void onRetry()}
            type="button"
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : isPending || settings === undefined ? (
        <div
          className="grid min-h-40 place-items-center text-body-small text-muted-foreground"
          role="status"
        >
          {t("loading")}
        </div>
      ) : (
        <>
          {activeSection === "appearance" ? <GeneralSettingsPanel

            activeSection={activeSection}
            apps={apps}
            settings={draft}
            onFollowUpChange={(followUpBehavior) => updateDraft((current) => ({ ...current, followUpBehavior }))}
            language={language}
            notificationsEnabled={notificationsEnabled}
            onDefaultOpenAppChange={(defaultOpenAppId) => {
              updateDraft((current) => ({ ...current, defaultOpenAppId }));
            }}
            onLanguageChange={(language) => updateBrowser({ language })}
            onNotificationsChange={(notificationsEnabled) => updateBrowser({ notificationsEnabled })}
            onThemeChange={(theme) => updateBrowser({ theme })}
            theme={theme}
          /> : null}

          {activeSection === "pets" ? (
            <GlobalSettingsPets
              onChange={(pet) => {
                updateDraft((current) => ({ ...current, pet }));
              }}
              settings={draft.pet}
            />
          ) : null}

          {activeSection === "agent" ? (
            <AgentSettingsPanel settings={draft} models={models} fastModeAvailable={fastModeAvailable} onChange={(next) => updateDraft(() => next)} />
          ) : null}


        </>
      )}
      </Suspense>
    </SettingsPageFrame>
  );
}
