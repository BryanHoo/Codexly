import type { AgentGlobalSettings } from "@codexly/protocol";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { changeAppLanguage, getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import "../../../i18n/settings-personalization.js";
import { Button } from "../../../shared/components/core/button.js";
import { setThemePreference } from "../theme-preference.js";
import {
  getNotificationPreference,
  setNotificationPreference,
} from "../notification-preference.js";
import { createFallbackSettings, readInitialTheme } from "./global-settings-model.js";
import {
  createGlobalSettingsSaveQueue,
  SETTINGS_INPUT_DEBOUNCE_MS,
} from "./global-settings-save-queue.js";
import type { GlobalSettingsPageProps, SettingsClient } from "./global-settings-page-contracts.js";
import { SettingsPageFrame } from "./settings-page-frame.js";
import type { SettingsSectionId } from "./global-settings-fields.js";
import { GeneralSettingsPanel } from "./general-settings-panel.js";
import { GlobalSettingsAccess } from "./global-settings-access.js";

const AgentSettingsPanel = lazy(() =>
  import("./agent-settings-panel.js").then((module) => ({ default: module.AgentSettingsPanel })),
);
const PersonalizationSettingsPanel = lazy(() =>
  import("./personalization-settings-panel.js").then((module) => ({
    default: module.PersonalizationSettingsPanel,
  })),
);
const CommitSettingsPanel = lazy(() =>
  import("./commit-settings-panel.js").then((module) => ({ default: module.CommitSettingsPanel })),
);
const ProviderConnectionPanel = lazy(() =>
  import("../../provider-connection/components/provider-connection-panel.js").then((module) => ({
    default: module.ProviderConnectionPanel,
  })),
);
const GlobalSettingsPets = lazy(() =>
  import("../../pets/components/global-settings-pets.js").then((module) => ({
    default: module.GlobalSettingsPets,
  })),
);
const GlobalSettingsAbout = lazy(() =>
  import("./global-settings-about.js").then((module) => ({ default: module.GlobalSettingsAbout })),
);

export function GlobalSettingsPage({
  client,
  accessMode = "local",
  initialSection = "appearance",
  settings,
  models,
  onSave,
  onClose,
  error,
  isPending,
  apps,
  fastModeAvailable = false,
  onRetry,
  ...props
}: GlobalSettingsPageProps & Readonly<{ client: SettingsClient }>) {
  const { t } = useTranslation("settings");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState(() => settings ?? createFallbackSettings(models));
  const [theme, setTheme] = useState(readInitialTheme);
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  const changed = useRef(false);
  const failed = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const [queue] = useState(() =>
    createGlobalSettingsSaveQueue(async (next) => {
      if (mounted.current) setSaving(true);
      try {
        await onSaveRef.current(next);
        failed.current = false;
        if (mounted.current) setSaveError(false);
      } catch (failure) {
        failed.current = true;
        if (mounted.current) setSaveError(true);
        throw failure;
      } finally {
        if (mounted.current) setSaving(false);
      }
    }),
  );
  useEffect(() => {
    if (settings && !changed.current) {
      draftRef.current = settings;
      setDraft(settings);
      queue.reset(settings);
    }
  }, [settings, queue]);
  useEffect(() => {
    mounted.current = true;
    // 页面卸载时提交最后的防抖草稿，网络请求继续由已有客户端完成。
    return () => {
      mounted.current = false;
      if (changed.current) void queue.flush(draftRef.current);
    };
  }, [queue]);
  const update = (fn: (current: AgentGlobalSettings) => AgentGlobalSettings, debounce = false) => {
    const next = fn(draftRef.current);
    changed.current = true;
    draftRef.current = next;
    setDraft(next);
    if (debounce) queue.schedule(next, SETTINGS_INPUT_DEBOUNCE_MS);
    else queue.save(next);
  };
  const status = (
    <p role="status" className="text-body-small text-muted-foreground">
      {t("loading")}
    </p>
  );
  const close = () => {
    if (closing.current) return;
    if (!changed.current) {
      onClose();
      return;
    }
    closing.current = true;
    // 返回前等待最新快照落盘；失败时留在设置页，保留草稿供重试。
    void queue.flush(draftRef.current).then(() => {
      closing.current = false;
      if (!failed.current) onClose();
    });
  };
  const failure = (
    <div role="alert">
      <p className="text-danger">{t("errors.load")}</p>
      <Button variant="ghost" onClick={() => void onRetry()}>
        {t("common:actions.retry")}
      </Button>
    </div>
  );
  const ready = error === null && !isPending && settings !== undefined;
  return (
    <SettingsPageFrame
      activeSection={activeSection}
      accessMode={accessMode}
      onBack={close}
      onSectionChange={setActiveSection}
    >
      {saving ? (
        <p role="status" className="mb-3 text-body-small text-muted-foreground">
          {t("actions.saving")}
        </p>
      ) : null}
      {saveError ? (
        <div role="alert" className="mb-4 text-danger">
          {t("personalization.saveError")}
          <Button
            variant="ghost"
            onClick={() => {
              queue.save(draftRef.current);
            }}
          >
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : null}
      <Suspense fallback={status}>
        {activeSection === "about" ? (
          <GlobalSettingsAbout
            activeSection="about"
            {...(props.appInfo === undefined ? {} : { appInfo: props.appInfo })}
            error={props.appInfoError ?? null}
            isPending={props.isAppInfoPending ?? false}
            isUpdatePending={props.isAppUpdatePending ?? false}
            onRetry={props.onRetryAppInfo ?? (() => undefined)}
            onUpdate={props.onUpdate ?? (() => Promise.resolve())}
            {...(props.appUpdateProgress === undefined
              ? {}
              : { updateProgress: props.appUpdateProgress })}
          />
        ) : activeSection === "provider" ? (
          <section>
            <h1 className="mb-6 text-xl font-semibold">{t("sections.provider")}</h1>
            <ProviderConnectionPanel />
          </section>
        ) : activeSection === "access" && accessMode === "lan" ? (
          <GlobalSettingsAccess
            activeSection="access"
            {...(props.onLogoutAccess === undefined ? {} : { onLogout: props.onLogoutAccess })}
          />
        ) : activeSection === "personalization" ? (
          <PersonalizationSettingsPanel
            client={client}
            commitSettings={
              ready ? (
                <CommitSettingsPanel
                  settings={draft}
                  models={models}
                  onChange={update}
                  onFlush={() => {
                    queue.save(draftRef.current);
                  }}
                />
              ) : error ? (
                failure
              ) : (
                status
              )
            }
          />
        ) : !ready ? (
          error ? (
            failure
          ) : (
            status
          )
        ) : activeSection === "appearance" ? (
          <GeneralSettingsPanel
            activeSection="appearance"
            apps={apps}
            settings={draft}
            theme={theme}
            language={language}
            notificationsEnabled={notificationsEnabled}
            onDefaultOpenAppChange={(defaultOpenAppId) => {
              update((current) => ({ ...current, defaultOpenAppId }));
            }}
            onFollowUpChange={(followUpBehavior) => {
              update((current) => ({ ...current, followUpBehavior }));
            }}
            onThemeChange={(value) => {
              setTheme(value);
              setThemePreference(value);
            }}
            onLanguageChange={(value) => {
              setLanguage(value);
              void changeAppLanguage(value);
            }}
            onNotificationsChange={(value) => {
              setNotificationsEnabled(value);
              setNotificationPreference(value);
            }}
          />
        ) : activeSection === "pets" ? (
          <GlobalSettingsPets
            settings={draft.pet}
            onChange={(pet) => {
              update((current) => ({ ...current, pet }));
            }}
          />
        ) : activeSection === "agent" ? (
          <AgentSettingsPanel
            client={client}
            settings={draft}
            models={models}
            fastModeAvailable={fastModeAvailable}
            onChange={(next) => {
              update(() => next);
            }}
          />
        ) : null}
      </Suspense>
    </SettingsPageFrame>
  );
}
