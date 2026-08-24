import type { AppInfoResponse } from "@code-agent/protocol";
import { BookOpen, Download, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { cn } from "../../../shared/lib/utils.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { AppReleaseNotesDialog } from "./app-release-notes-dialog.js";
import { SettingsField, SettingsPanel, type SettingsSectionId } from "./global-settings-fields.js";

export function GlobalSettingsAbout({
  activeSection,
  appInfo,
  error,
  isPending,
  isUpdatePending,
  onRetry,
  onUpdate,
}: Readonly<{
  activeSection: SettingsSectionId;
  appInfo?: AppInfoResponse;
  error: Error | null;
  isPending: boolean;
  isUpdatePending?: boolean;
  onRetry: () => unknown;
  onUpdate: (version: string) => Promise<void>;
}>) {
  const { t } = useTranslation("settings");
  const updateLockRef = useRef(createAsyncActionLock());
  const checkLockRef = useRef(createAsyncActionLock());
  const [isChecking, setIsChecking] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const updating = isUpdating || isUpdatePending === true;
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
          <SettingsField label={t("about.codeAgentVersion")}>
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
                href="https://github.com/BryanHoo/CodeAgent"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GitFork aria-hidden="true" data-icon="inline-start" />
                BryanHoo/CodeAgent
              </a>
            </Button>
          </SettingsField>
          <SettingsField alignStart label={t("about.update")}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 py-2">
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
    </SettingsPanel>
  );
}
