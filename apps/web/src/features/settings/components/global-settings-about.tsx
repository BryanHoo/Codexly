import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import type { AppInfoResponse, AppUpdateProgress } from "@codexly/protocol";
import { BookOpen, Download, FileArchive, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { cn } from "../../../shared/lib/utils.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

const APP_UPDATE_PROGRESS_TRANSLATION_KEYS = {
  "backing-up": "about.progress.backingUp",
  checking: "about.progress.checking",
  completed: "about.progress.completed",
  downloading: "about.progress.downloading",
  installing: "about.progress.installing",
  "rolling-back": "about.progress.rollingBack",
} as const;

export function GlobalSettingsAbout({
  activeSection,
  appInfo,
  error,
  isPending,
  isUpdatePending,
  onRetry,
  onExportDiagnostics,
  onUpdate,
  updateProgress,
}: Readonly<{
  activeSection: SettingsSectionId;
  appInfo?: AppInfoResponse;
  error: Error | null;
  isPending: boolean;
  isUpdatePending?: boolean;
  onRetry: () => unknown;
  onExportDiagnostics: () => Promise<string>;
  onUpdate: (version: string) => Promise<void>;
  updateProgress?: AppUpdateProgress;
}>) {
  const { t } = useTranslation("settings");
  const exportLockRef = useRef(createAsyncActionLock());
  const [isExporting, setIsExporting] = useState(false);
  const updateLockRef = useRef(createAsyncActionLock());
  const checkLockRef = useRef(createAsyncActionLock());
  const [isChecking, setIsChecking] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updating = isUpdating || isUpdatePending === true;
  const retryAppInfo = useEffectEvent(onRetry);
  useEffect(() => {
    if (activeSection === "about") {
      // 每次进入“关于”页都绕过查询缓存，展示 registry 当前的最新版本。
      void retryAppInfo();
    }
  }, [activeSection]);
  const checkForUpdates = () =>
    checkLockRef.current.run(async () => {
      setIsChecking(true);
      try {
        await onRetry();
      } finally {
        setIsChecking(false);
      }
    });

  return (
    <SettingsPanel activeSection={activeSection} id="about" title={t("sections.about")}>
      {isPending ? (
        <p className="py-5 text-body-small text-muted-foreground" role="status">
          {t("about.loading")}
        </p>
      ) : error !== null || appInfo === undefined ? (
        <div className="flex items-center justify-between gap-3 py-4" role="alert">
          <p className="text-body-small text-danger">{t("errors.appInfo")}</p>
          <Button onClick={() => void onRetry()} size="sm" type="button" variant="ghost">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("about.retry")}
          </Button>
        </div>
      ) : (
        <>
          <SettingsField label={t("about.codexlyVersion")}>
            <span className="font-mono text-body-small text-foreground">{appInfo.appVersion}</span>
          </SettingsField>
          <SettingsField label={t("about.codexVersion")}>
            <span className="font-mono text-body-small text-foreground">
              {appInfo.codexVersion}
            </span>
          </SettingsField>
          <SettingsField label={t("about.claudeVersion")}>
            <span className="font-mono text-body-small text-foreground">
              {/* 兼容旧服务端未返回版本及运行时版本未知的情况。 */}
              {appInfo.claudeVersion ?? t("about.unknownVersion")}
            </span>
          </SettingsField>
          <SettingsField label={t("about.github")}>
            <Button asChild className="justify-self-start" size="sm" variant="link">
              <a
                href="https://github.com/BryanHoo/Codexly"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitFork aria-hidden="true" data-icon="inline-start" />
                BryanHoo/Codexly
              </a>
            </Button>
          </SettingsField>
          <SettingsField alignStart expandControl label={t("about.update")}>
            <div className="w-full min-w-0 max-w-full py-2">
              {/* 检查按钮固定在操作区起点，版本状态变化不会让连续点击误触安装。 */}
              <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
                <Button
                  disabled={isChecking}
                  onClick={() => void checkForUpdates()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {isChecking ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <RefreshCw aria-hidden="true" data-icon="inline-start" />
                  )}
                  {isChecking ? t("about.checking") : t("about.check")}
                </Button>
                {appInfo.status === "available" && appInfo.latestVersion !== null ? (
                  <>
                    <Button
                      onClick={() => {
                        setReleaseNotesOpen(true);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <BookOpen aria-hidden="true" data-icon="inline-start" />
                      {t("about.releaseNotes")}
                    </Button>
                    <Button
                      disabled={updating}
                      onClick={() => {
                        const version = appInfo.latestVersion;
                        if (version === null) return;
                        void updateLockRef.current.run(async () => {
                          setIsUpdating(true);
                          try {
                            await onUpdate(version);
                          } catch {
                            // 根级 MutationCache 已展示更新失败，保留当前版本状态供用户重试。
                          } finally {
                            setIsUpdating(false);
                          }
                        });
                      }}
                      size="sm"
                      type="button"
                    >
                      {updating ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="animate-spin"
                          data-icon="inline-start"
                        />
                      ) : (
                        <Download aria-hidden="true" data-icon="inline-start" />
                      )}
                      {updating
                        ? t("about.updating")
                        : t("about.updateTo", { version: appInfo.latestVersion })}
                    </Button>
                  </>
                ) : null}
                <p
                  className={cn(
                    "shrink-0 text-body-small",
                    appInfo.status === "available"
                      ? "text-warning"
                      : appInfo.status === "check-failed"
                        ? "text-danger"
                        : "text-muted-foreground",
                  )}
                  role={appInfo.status === "check-failed" ? "alert" : "status"}
                >
                  {appInfo.status === "available" && appInfo.latestVersion !== null
                    ? t("about.available", { version: appInfo.latestVersion })
                    : appInfo.status === "restart-required"
                      ? t("about.restartRequired")
                      : appInfo.status === "check-failed"
                        ? t("errors.updateCheck")
                        : t("about.current")}
                </p>
              </div>
              {!updating || updateProgress === undefined ? null : (
                <div aria-live="polite" className="mt-3 grid w-full min-w-0 gap-1.5">
                  <div className="flex min-w-0 items-center justify-between gap-3 text-caption text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {t(APP_UPDATE_PROGRESS_TRANSLATION_KEYS[updateProgress.phase])}
                    </span>
                    <span className="shrink-0 tabular-nums">{updateProgress.percent}%</span>
                  </div>
                  <div
                    aria-label={t("about.progress.label")}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={updateProgress.percent}
                    className="h-1.5 w-full overflow-hidden rounded-sm bg-control"
                    role="progressbar"
                  >
                    <div
                      className="h-full bg-brand transition-[width] duration-200 motion-reduce:transition-none"
                      style={{ width: `${String(updateProgress.percent)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </SettingsField>
          {appInfo.latestVersion === null ? null : (
            <AppReleaseNotesDialog
              notes={appInfo.releaseNotes}
              onClose={() => {
                setReleaseNotesOpen(false);
              }}
              open={releaseNotesOpen}
              version={appInfo.latestVersion}
            />
          )}
        </>
      )}
      {/* 导出独立于版本查询，检查失败或加载期间也可以用于排错。 */}
      <SettingsField label={t("about.diagnostics")}>
        <Button
          className="justify-self-start"
          disabled={isExporting}
          onClick={() => {
            void exportLockRef.current.run(async () => {
              setIsExporting(true);
              try {
                const fileName = await onExportDiagnostics();
                notifyActionSuccess(t("about.diagnosticsExported", { fileName }));
              } catch {
                notifyActionError(t("about.diagnosticsExportFailed"));
              } finally {
                setIsExporting(false);
              }
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {isExporting ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" data-icon="inline-start" />
          ) : (
            <FileArchive aria-hidden="true" data-icon="inline-start" />
          )}
          {isExporting ? t("about.exportingDiagnostics") : t("about.exportDiagnostics")}
        </Button>
      </SettingsField>
    </SettingsPanel>
  );
}
