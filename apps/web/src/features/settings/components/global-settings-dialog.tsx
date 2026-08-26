import type {
  AccessMode,
  AgentGlobalSettings,
  AgentModel,
  AppInfoResponse,
  ProjectOpenApp,
} from "@codexly/protocol";
import { Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import { Tooltip } from "../../../shared/components/core/tooltip.js";
import { TooltipContent } from "../../../shared/components/core/tooltip.js";
import { TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { changeAppLanguage, getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { setThemePreference, type ThemePreference } from "../theme-preference.js";
import { applyWorkbenchBackgroundPreference } from "../workbench-background-preference.js";
import {
  getNotificationPreference,
  setNotificationPreference,
} from "../notification-preference.js";
import {
  AppearanceSettingsPanel,
  FastModeSettingsField,
  ModelSelect,
  ReasoningSelect,
  SettingsField,
  SettingsPanel,
  SettingsSelect,
  settingsSections,
  type SettingsSectionId,
} from "./global-settings-fields.js";
import {
  applyApprovalMode,
  createFallbackSettings,
  deriveApprovalMode,
  readInitialTheme,
  resolveGlobalSettingsModel,
  type ApprovalMode,
} from "./global-settings-model.js";
import { saveGlobalSettingsDraft } from "./global-settings-save.js";
import { GlobalSettingsAbout } from "./global-settings-about.js";
import { GlobalSettingsAccess } from "./global-settings-access.js";
import { ProviderConnectionPanel } from "../../provider-connection/components/provider-connection-panel.js";
import { GlobalSettingsPets } from "../../pets/components/global-settings-pets.js";
import { useWorkbenchBackgroundDraft } from "./use-workbench-background-draft.js";
export { resolveGlobalSettingsModel } from "./global-settings-model.js";

type GlobalSettingsDialogProps = Readonly<{
  accessMode?: AccessMode;
  appInfo?: AppInfoResponse;
  appInfoError?: Error | null;
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  fastModeAvailable?: boolean;
  initialSection?: SettingsSectionId;
  isAppInfoPending?: boolean;
  isAppUpdatePending?: boolean;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onLogoutAccess?: () => Promise<void>;
  onRetry: () => unknown;
  onRetryAppInfo?: () => unknown;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  onUpdate?: (version: string) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;

export function GlobalSettingsDialog({
  accessMode = "local",
  appInfo,
  appInfoError = null,
  apps,
  error,
  fastModeAvailable = false,
  initialSection = "appearance",
  isAppInfoPending = false,
  isAppUpdatePending = false,
  isPending,
  models,
  onClose,
  onLogoutAccess,
  onRetry,
  onRetryAppInfo = () => undefined,
  onSave,
  onUpdate = () => Promise.resolve(),
  settings,
}: GlobalSettingsDialogProps) {
  const { t } = useTranslation("settings");
  const saveLockRef = useRef(createAsyncActionLock());
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [theme, setTheme] = useState<ThemePreference>(readInitialTheme);
  const {
    background,
    customBackgroundFile,
    customBackgroundMissing,
    setBackground,
    setCustomBackgroundFile,
  } = useWorkbenchBackgroundDraft();
  const [language, setLanguage] = useState(getCurrentLanguage);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference);
  const [isSaving, setIsSaving] = useState(false);
  const selectedModel = models.find((model) => model.id === draft.model);
  useEffect(() => {
    if (settings !== undefined) {
      setDraft(settings);
    }
  }, [settings]);

  const close = () => {
    if (!isSaving) {
      onClose();
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
    >
      <DialogContent
        aria-labelledby="global-settings-title"
        className="h-[min(88dvh,38rem)] max-w-[54rem] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <form
          className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (settings === undefined || isPending || isSaving) {
              return;
            }
            void saveLockRef.current.run(async () => {
              setIsSaving(true);
              try {
                await saveGlobalSettingsDraft(
                  draft,
                  {
                    background,
                    customBackgroundImage: customBackgroundFile,
                    language,
                    notificationsEnabled,
                    theme,
                  },
                  {
                    applyBrowserSettings: async (browserSettings) => {
                      await applyWorkbenchBackgroundPreference(
                        browserSettings.background,
                        browserSettings.customBackgroundImage,
                      );
                      if (typeof window !== "undefined") {
                        setThemePreference(browserSettings.theme);
                      }
                      setNotificationPreference(browserSettings.notificationsEnabled);
                      await changeAppLanguage(browserSettings.language);
                    },
                    saveGlobalSettings: onSave,
                  },
                );
                onClose();
              } catch {
                // 根级 MutationCache 已统一展示失败 toast，Dialog 只保留可重试草稿。
              } finally {
                setIsSaving(false);
              }
            });
          }}
        >
          <header className="flex h-12 items-center gap-2.5 px-4 shadow-toolbar">
            <Settings className="size-4 text-brand" aria-hidden="true" />
            <DialogTitle
              className="min-w-0 flex-1 truncate text-heading font-semibold"
              id="global-settings-title"
            >
              {t("title")}
            </DialogTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t("actions.closeDialog")}
                  disabled={isSaving}
                  onClick={close}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("actions.close")}</TooltipContent>
            </Tooltip>
          </header>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[var(--ui-layout-settings-sidebar-width)_minmax(0,1fr)] sm:grid-rows-1">
            <aside className="min-w-0 bg-control px-2 py-2 sm:px-3 sm:py-4 sm:shadow-divider">
              <nav
                aria-label={t("navigationLabel")}
                className="flex min-w-0 gap-1 overflow-x-auto sm:flex-col sm:overflow-visible"
              >
                {settingsSections
                  .filter((section) => section.id !== "access" || accessMode === "lan")
                  .map((section) => {
                    const Icon = section.icon;
                    const selected = activeSection === section.id;
                    return (
                      <Button
                        variant="ghost"
                        aria-controls={`settings-panel-${section.id}`}
                        aria-current={selected ? "page" : undefined}
                        className={`flex h-9 shrink-0 items-center gap-2 rounded-control px-2.5 text-left text-body-small font-medium transition-colors focus-visible:shadow-focus sm:w-full ${selected ? "bg-brand text-brand-contrast shadow-control" : "text-muted-foreground hover:bg-control-hover hover:text-foreground"}`}
                        contentAlign="start"
                        key={section.id}
                        onClick={() => {
                          setActiveSection(section.id);
                        }}
                        type="button"
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        <span>{t(`sections.${section.id}`)}</span>
                      </Button>
                    );
                  })}
              </nav>
            </aside>
            <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <GlobalSettingsAbout
                activeSection={activeSection}
                {...(appInfo === undefined ? {} : { appInfo })}
                error={appInfoError}
                isPending={isAppInfoPending}
                isUpdatePending={isAppUpdatePending}
                onRetry={onRetryAppInfo}
                onUpdate={onUpdate}
              />

              {activeSection === "provider" ? (
                <section id="settings-panel-provider">
                  <h3 className="mb-4 text-heading font-semibold">{t("sections.provider")}</h3>
                  <ProviderConnectionPanel />
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
                  <AppearanceSettingsPanel
                    activeSection={activeSection}
                    background={background}
                    customBackgroundFile={customBackgroundFile}
                    isSaving={isSaving}
                    language={language}
                    notificationsEnabled={notificationsEnabled}
                    onLanguageChange={setLanguage}
                    onNotificationsChange={setNotificationsEnabled}
                    onBackgroundChange={setBackground}
                    onCustomBackgroundFileChange={setCustomBackgroundFile}
                    onThemeChange={setTheme}
                    theme={theme}
                  />

                  {activeSection === "pets" ? (
                    <GlobalSettingsPets
                      onChange={(pet) => {
                        setDraft((current) => ({ ...current, pet }));
                      }}
                      settings={draft.pet}
                    />
                  ) : null}

                  {accessMode === "lan" ? (
                    <GlobalSettingsAccess
                      activeSection={activeSection}
                      {...(onLogoutAccess === undefined ? {} : { onLogout: onLogoutAccess })}
                    />
                  ) : null}

                  <SettingsPanel
                    activeSection={activeSection}
                    id="agent"
                    title={t("sections.agent")}
                  >
                    <SettingsField label={t("fields.approvalPolicy")}>
                      <SettingsSelect
                        aria-label={t("fields.approvalPolicy")}
                        disabled={isSaving}
                        onChange={(event) => {
                          const mode = event.currentTarget.value as ApprovalMode;
                          setDraft((current) => applyApprovalMode(current, mode));
                        }}
                        value={deriveApprovalMode(draft)}
                      >
                        <option value="on-request">{t("approval.onRequest")}</option>
                        <option value="auto-review">{t("approval.autoReview")}</option>
                        <option value="never">{t("approval.never")}</option>
                      </SettingsSelect>
                    </SettingsField>
                    <SettingsField label={t("fields.sandbox")}>
                      <SettingsSelect
                        aria-label={t("fields.sandbox")}
                        disabled={isSaving}
                        onChange={(event) => {
                          const sandboxMode = event.currentTarget
                            .value as AgentGlobalSettings["sandboxMode"];
                          setDraft((current) => ({ ...current, sandboxMode }));
                        }}
                        value={draft.sandboxMode}
                      >
                        <option value="read-only">{t("sandbox.readOnly")}</option>
                        <option value="workspace-write">{t("sandbox.workspaceWrite")}</option>
                        <option value="danger-full-access">{t("sandbox.dangerFullAccess")}</option>
                      </SettingsSelect>
                    </SettingsField>
                    <SettingsField label={t("fields.followUpMessages")}>
                      <SettingsSelect
                        aria-label={t("fields.followUpMessages")}
                        disabled={isSaving}
                        onChange={(event) => {
                          const followUpBehavior = event.currentTarget
                            .value as AgentGlobalSettings["followUpBehavior"];
                          setDraft((current) => ({ ...current, followUpBehavior }));
                        }}
                        value={draft.followUpBehavior}
                      >
                        <option value="queue">{t("followUp.queue")}</option>
                        <option value="steer">{t("followUp.steer")}</option>
                      </SettingsSelect>
                    </SettingsField>
                    {fastModeAvailable ? (
                      <FastModeSettingsField
                        disabled={isSaving}
                        enabled={draft.fastMode}
                        onChange={(fastMode) => {
                          setDraft((current) => ({ ...current, fastMode }));
                        }}
                      />
                    ) : null}
                    <SettingsField label={t("fields.model")}>
                      <ModelSelect
                        ariaLabel={t("fields.model")}
                        disabled={isSaving}
                        models={models}
                        onChange={(modelId) => {
                          setDraft((current) => ({
                            ...current,
                            ...resolveGlobalSettingsModel(models, modelId, current.reasoningEffort),
                          }));
                        }}
                        value={draft.model}
                      />
                    </SettingsField>
                    <SettingsField label={t("fields.reasoningEffort")}>
                      <ReasoningSelect
                        ariaLabel={t("fields.reasoningEffort")}
                        disabled={isSaving || selectedModel === undefined}
                        model={selectedModel}
                        onChange={(reasoningEffort) => {
                          setDraft((current) => ({ ...current, reasoningEffort }));
                        }}
                        value={draft.reasoningEffort}
                      />
                    </SettingsField>
                  </SettingsPanel>

                  <SettingsPanel
                    activeSection={activeSection}
                    id="commit"
                    title={t("sections.commit")}
                  >
                    <SettingsField label={t("fields.model")}>
                      <ModelSelect
                        ariaLabel={t("fields.commitModel")}
                        disabled={isSaving}
                        models={models}
                        onChange={(modelId) => {
                          setDraft((current) => ({ ...current, commitMessageModel: modelId }));
                        }}
                        value={draft.commitMessageModel}
                      />
                    </SettingsField>
                    <SettingsField alignStart label={t("fields.prompt")}>
                      <textarea
                        aria-label={t("fields.commitMessagePrompt")}
                        className="h-28 w-full resize-none rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus disabled:opacity-50"
                        disabled={isSaving}
                        maxLength={4_000}
                        onChange={(event) => {
                          const commitMessagePrompt = event.currentTarget.value;
                          setDraft((current) => ({ ...current, commitMessagePrompt }));
                        }}
                        value={draft.commitMessagePrompt}
                      />
                    </SettingsField>
                  </SettingsPanel>

                  <SettingsPanel
                    activeSection={activeSection}
                    id="integration"
                    title={t("sections.integration")}
                  >
                    <SettingsField label={t("fields.defaultOpenWith")}>
                      <SettingsSelect
                        aria-label={t("fields.defaultOpenWith")}
                        disabled={isSaving}
                        onChange={(event) => {
                          const appId = event.currentTarget.value;
                          setDraft((current) => ({
                            ...current,
                            defaultOpenAppId:
                              appId === ""
                                ? null
                                : (appId as AgentGlobalSettings["defaultOpenAppId"]),
                          }));
                        }}
                        value={draft.defaultOpenAppId ?? ""}
                      >
                        <option value="">{t("integration.automatic")}</option>
                        {apps
                          .filter((app) => app.kind !== "system-default")
                          .map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.name}
                            </option>
                          ))}
                      </SettingsSelect>
                    </SettingsField>
                  </SettingsPanel>
                </>
              )}
            </div>
          </div>

          <footer className="flex min-h-14 items-center justify-end gap-2 px-4 shadow-[0_-1px_0_var(--ui-color-separator)] sm:px-5">
            <Button
              variant="ghost"
              className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
              disabled={isSaving}
              onClick={close}
              type="button"
            >
              {activeSection === "provider" ? t("actions.close") : t("actions.cancel")}
            </Button>
            {activeSection === "provider" ? null : (
              <Button
                disabled={
                  isPending || isSaving || settings === undefined || customBackgroundMissing
                }
                type="submit"
                variant="default"
              >
                {isSaving ? t("actions.saving") : t("actions.save")}
              </Button>
            )}
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
