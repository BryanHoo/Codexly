import type {
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  AppUpdateInstallProgress,
  ExportDiagnosticsResponse,
  ProjectOpenApp,
} from "@/protocol/index.js";
import { Suspense, useEffect, useRef, useState } from "react";

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
import { GlobalSettingsAbout, ProviderConnectionPanel, GlobalSettingsPets, AgentSettingsPanel, GeneralSettingsPanel, PersonalizationSettingsPanel, CommitSettingsPanel } from "./settings-section-loaders.js";
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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const draftRef = useRef(draft);
  const hasLocalChangesRef = useRef(false);
  const saveQueueRef = useRef<ReturnType<typeof createGlobalSettingsSaveQueue> | null>(null);
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createGlobalSettingsSaveQueue((next) => onSaveRef.current(next));
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

  const close = () => {
    void saveQueue.flush(draftRef.current);
    onClose();
  };

  return (
    <SettingsPageFrame
      activeSection={activeSection}
      onBack={close}
      onSectionChange={setActiveSection}
    >
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

      {activeSection === "provider" ? (
        <section id="settings-panel-provider">
          <h1 className="mb-6 text-xl font-semibold">{t("sections.provider")}</h1>
          <ProviderConnectionPanel />
        </section>
      ) : activeSection === "personalization" ? (
        <PersonalizationSettingsPanel commitSettings={
          error !== null ? <div role="alert" className="text-body-small text-danger">
            <p>{t("errors.load")}</p>
            <Button variant="ghost" onClick={() => void onRetry()}>{t("common:actions.retry")}</Button>
          </div> : isPending || settings === undefined ? <p role="status" className="text-body-small text-muted-foreground">{t("loading")}</p> : (
            <CommitSettingsPanel settings={draft} models={models} onChange={updateDraft} onSaveRules={async (commitMessagePrompt) => {
              // 先等待已有自动保存完成；成功后才更新全局快照，失败时由编辑器保留草稿。
              await saveQueue.flush();
              const next = { ...draftRef.current, commitMessagePrompt };
              await onSaveRef.current(next);
              saveQueue.reset(next);
              draftRef.current = { ...draftRef.current, commitMessagePrompt };
              hasLocalChangesRef.current = true;
              setDraft(draftRef.current);
            }} />
          )
        } />

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
            onLanguageChange={(nextLanguage) => {
              setLanguage(nextLanguage);
              void applyBrowserSettingsChanges({ language: nextLanguage }).catch(
                () => undefined,
              );
            }}
            onNotificationsChange={(enabled) => {
              setNotificationsEnabled(enabled);
              void applyBrowserSettingsChanges({ notificationsEnabled: enabled }).catch(
                () => undefined,
              );
            }}
            onThemeChange={(nextTheme) => {
              setTheme(nextTheme);
              void applyBrowserSettingsChanges({ theme: nextTheme }).catch(() => undefined);
            }}
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
