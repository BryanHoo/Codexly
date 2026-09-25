import type {
  AppInfoResponse,
  AppUpdateInstallProgress,
  ExportDiagnosticsResponse,
} from "@/protocol/index.js";
import { BookOpen, Download, FileArchive, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { cn } from "../../../shared/lib/utils.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

export function GlobalSettingsAbout({
  activeSection,
  appInfo,
  error,
  isPending,
  onRetry,
  onExportDiagnostics,
  onUpdate,
}: Readonly<{
  activeSection: SettingsSectionId;
  appInfo?: AppInfoResponse;
  error: Error | null;
  isPending: boolean;
  onRetry: () => unknown;
  onExportDiagnostics: () => Promise<ExportDiagnosticsResponse>;
  onUpdate: (
    version: string,
    onProgress: (progress: AppUpdateInstallProgress) => void,
  ) => Promise<void>;
}>) {
  const { t } = useTranslation("settings");
  const checkLockRef = useRef(createAsyncActionLock());
  const [isChecking, setIsChecking] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const exportLockRef = useRef(createAsyncActionLock());
  const [isExporting, setIsExporting] = useState(false);
  const updateLockRef = useRef(createAsyncActionLock());
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateInstallProgress | null>(null);
  const updatePercentage = calculateUpdatePercentage(updateProgress);
  const updateFailed = appInfo?.status === "check-failed" || appInfo?.status === "connection-failed";
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
          <SettingsField label={t("about.codeagentVersion")}>
            <span className="font-mono text-body-small text-foreground">{appInfo.appVersion}</span>
          </SettingsField>
          <SettingsField label={t("about.codexVersion")}>
            <span className="font-mono text-body-small text-foreground">
              {appInfo.codexVersion}
            </span>
          </SettingsField>
          <SettingsField label={t("about.github")}>
            <Button asChild className="justify-self-start" size="sm" variant="link">
              <a
                href={appInfo.repositoryUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitFork aria-hidden="true" data-icon="inline-start" />
                BryanHoo/Codexly
              </a>
            </Button>
          </SettingsField>
          <SettingsField alignStart label={t("about.update")}>
            <div className="flex min-w-0 flex-nowrap items-center gap-2 py-2">
              <p
                className={cn(
                  "shrink-0 text-body-small",
                  appInfo.status === "available"
                    ? "text-warning"
                    : updateFailed
                      ? "text-danger"
                      : "text-muted-foreground",
                )}
                role={updateFailed ? "alert" : "status"}
              >
                {appInfo.status === "available" && appInfo.latestVersion !== null
                  ? t("about.available", { version: appInfo.latestVersion })
                  : appInfo.status === "connection-failed"
                    ? t("errors.githubConnection")
                    : appInfo.status === "check-failed"
                      ? t("errors.updateCheck")
                      : t("about.current")}
              </p>
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
                <Button
                  disabled={isUpdating}
                  onClick={() => {
                    const version = appInfo.latestVersion;
                    if (version === null) return;
                    void updateLockRef.current.run(async () => {
                      setIsUpdating(true);
                      setUpdateProgress(null);
                      try {
                        await onUpdate(version, setUpdateProgress);
                      } catch {
                        // 根级 MutationCache 展示失败，保留版本信息供用户重试。
                      } finally {
                        setIsUpdating(false);
                      }
                    });
                  }}
                  size="sm"
                  type="button"
                >
                  {isUpdating ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Download aria-hidden="true" data-icon="inline-start" />
                  )}
                  {isUpdating
                    ? updatePercentage === null
                      ? t("about.updating")
                      : t("about.downloading", { percentage: updatePercentage })
                    : t("about.updateTo", { version: appInfo.latestVersion })}
                </Button>
              ) : null}
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
            </div>
          </SettingsField>
          <AppReleaseNotesDialog
            changelogUrl={appInfo.changelogUrl}
            notes={appInfo.releaseNotes}
            onClose={() => {
              setReleaseNotesOpen(false);
            }}
            open={releaseNotesOpen}
            version={appInfo.releaseNotesVersion}
          />
        </>
      )}
      <SettingsField label={t("about.diagnostics")}>
        <Button
          className="justify-self-start"
          disabled={isExporting}
          onClick={() => {
            void exportLockRef.current.run(async () => {
              setIsExporting(true);
              try {
                const result = await onExportDiagnostics();
                if (result.status === "saved") {
                  notifyActionSuccess(
                    t("about.diagnosticsExported", { fileName: result.fileName }),
                  );
                }
              } catch (exportError) {
                notifyActionError(exportError);
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

function calculateUpdatePercentage(progress: AppUpdateInstallProgress | null): number | null {
  if (
    progress?.totalBytes === null ||
    progress?.totalBytes === undefined ||
    progress.totalBytes <= 0
  ) {
    return null;
  }
  return Math.min(
    100,
    Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
  );
}
