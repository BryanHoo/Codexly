import { LoadingSkeleton } from "@codexly/ui/core/loading-skeleton";
import { exportDiagnostics } from "../../../diagnostics.js";
import { ProjectDataContext } from "../../projects/project-context-state.js";
import { DefaultGenerationSettings } from "@codexly/ui/core/default-generation-settings";
import { useSettingsAutosave } from "@codexly/ui/core/use-settings-autosave";
import { SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
import { isClaudeSettingsSection } from "@codexly/frontend-core/settings-navigation";
import type { AgentGlobalSettings } from "@codexly/protocol";
import { lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
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

const UsageStatistics = lazy(() =>
  Promise.all([
    import("@codexly/ui/core/usage-statistics.css"),
    import("@codexly/ui/core/usage-statistics"),
  ]).then(([, module]) => ({ default: module.UsageStatistics })),
);

const SavedPromptsSettings = lazy(() =>
  import("@codexly/ui/core/saved-prompts-settings").then((module) => ({
    default: module.SavedPromptsSettings,
  })),
);
const AgentSettingsPanel = lazy(() =>
  import("./agent-settings-panel.js").then((module) => ({ default: module.AgentSettingsPanel })),
);
const ClaudeSettingsPanel = lazy(() =>
  import("./claude-settings-panel.js").then((module) => ({ default: module.ClaudeSettingsPanel })),
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
  const projectData = useContext(ProjectDataContext);
  const getGenerationModels = useCallback(
    async (engine: "codex" | "claude") =>
      engine === "codex" ? models : (await client.getEngineProfile(engine)).models.data,
    [models, client],
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState(() => settings ?? createFallbackSettings(models));
  const [theme, setTheme] = useState(readInitialTheme);
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const draftRef = useRef(draft);
  const changed = useRef(false);
  const closing = useRef(false);
  const mounted = useRef(true);
  const browserDraft = useRef({ theme, language, notificationsEnabled });
  const browserSave = useSettingsAutosave<typeof browserDraft.current>(async (next) => {
    if (readInitialTheme() !== next.theme) setThemePreference(next.theme);
    if (getNotificationPreference() !== next.notificationsEnabled)
      setNotificationPreference(next.notificationsEnabled);
    if (getCurrentLanguage() !== next.language) await changeAppLanguage(next.language);
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
  const [queue] = useState(() =>
    createGlobalSettingsSaveQueue(
      (next) => onSaveRef.current(next),
      (status) => {
        if (mounted.current) setSaveStatus(status);
      },
    ),
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
  const status = <LoadingSkeleton variant="settings" className="p-0" label={t("loading")} />;
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    // 返回前等待最新设置落盘；失败时保留当前页面，供用户重试。
    void Promise.all([
      queue.flush(changed.current ? draftRef.current : undefined),
      browserSave.queue.flush(),
    ]).then(([backendSaved, browserSaved]) => {
      closing.current = false;
      if (backendSaved && browserSaved) onClose();
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
      {activeSection === "appearance" ||
      activeSection === "pets" ||
      activeSection === "agent" ||
      activeSection === "git" ? (
        <SettingsSaveStatus
          status={saveStatus}
          labels={{
            saving: t("actions.saving"),
            saved: t("actions.saved"),
            saveError: t("errors.save"),
            retry: t("common:actions.retry"),
          }}
          onRetry={() => {
            queue.save(draftRef.current);
          }}
        />
      ) : null}
      {activeSection === "appearance" ? (
        <SettingsSaveStatus
          status={browserSave.status}
          labels={{
            saving: t("actions.saving"),
            saved: t("actions.saved"),
            saveError: t("errors.save"),
            retry: t("common:actions.retry"),
          }}
          onRetry={() => {
            void browserSave.queue.retry();
          }}
        />
      ) : null}
      <Suspense fallback={status}>
        {activeSection === "usage" ? (
          <UsageStatistics
            client={{
              getTokenUsage: (query) =>
                client.getTokenUsage
                  ? client.getTokenUsage(query)
                  : Promise.reject(new Error("Usage storage unavailable")),
            }}
            language={language}
          />
        ) : activeSection === "prompts" ? (
          <SavedPromptsSettings
            language={language}
            projects={projectData?.projects}
            projectsUnavailable={!projectData || projectData.isPending || !!projectData.error}
          />
        ) : isClaudeSettingsSection(activeSection) ? (
          <ClaudeSettingsPanel client={client} section={activeSection} />
        ) : activeSection === "about" ? (
          <GlobalSettingsAbout
            activeSection="about"
            onExportDiagnostics={() => exportDiagnostics(client, props.appInfo)}
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
            <ProviderConnectionPanel autoSave />
          </section>
        ) : activeSection === "access" && accessMode === "lan" ? (
          <GlobalSettingsAccess
            activeSection="access"
            {...(props.onLogoutAccess === undefined ? {} : { onLogout: props.onLogoutAccess })}
          />
        ) : activeSection === "personalization" ? (
          <PersonalizationSettingsPanel client={client} />
        ) : activeSection === "git" ? (
          <section id="settings-panel-git" className="space-y-6">
            <h1 className="text-xl font-semibold">{t("sections.git")}</h1>
            {ready ? (
              <>
                <DefaultGenerationSettings
                  settings={draft}
                  language={language}
                  getModels={getGenerationModels}
                  onChange={(patch) => {
                    update((current) => ({ ...current, ...patch }));
                  }}
                />
                <CommitSettingsPanel
                  settings={draft}
                  onChange={update}
                  onFlush={() => {
                    queue.save(draftRef.current);
                  }}
                />
              </>
            ) : error ? (
              failure
            ) : (
              status
            )}
          </section>
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
              updateBrowser({ theme: value });
            }}
            onLanguageChange={(value) => {
              updateBrowser({ language: value });
            }}
            onNotificationsChange={(value) => {
              updateBrowser({ notificationsEnabled: value });
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
