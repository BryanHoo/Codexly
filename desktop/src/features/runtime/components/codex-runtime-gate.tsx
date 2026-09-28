import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Download,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  downloadAndInspectCodexRuntime,
} from "../../../platform/tauri/codex-runtime-manager.js";
import type {
  CodexRuntimeAvailability,
  CodexRuntimeInstallProgress,
} from "../../../protocol/index.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  CODEX_RUNTIME_QUERY_KEY,
  inspectRuntimeQuery,
} from "../codex-runtime-queries.js";

type CodexRuntimeGateProps = Readonly<{ children: ReactNode }>;

export function CodexRuntimeGate({ children }: CodexRuntimeGateProps) {
  const queryClient = useQueryClient();
  const [downloadProgress, setDownloadProgress] = useState<CodexRuntimeInstallProgress | null>(null);
  const [startupProgress, setStartupProgress] = useState<CodexRuntimeInstallProgress | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const availabilityQuery = useQuery({
    meta: { onProgress: setStartupProgress, onInspect: () => setIsInspecting(true) },
    queryFn: inspectRuntimeQuery,
    queryKey: CODEX_RUNTIME_QUERY_KEY,
    retry: false,
    staleTime: Infinity,
  });
  const installMutation = useMutation({
    mutationFn: () => downloadAndInspectCodexRuntime(setDownloadProgress),
    onError() {
      setDownloadProgress(null);
    },
    onSuccess(availability) {
      queryClient.setQueryData(CODEX_RUNTIME_QUERY_KEY, availability);
    },
  });
  const availability = availabilityQuery.data;
  if (startupProgress !== null && (availabilityQuery.isPending || availabilityQuery.isFetching)) {
    return <RuntimeUpdating progress={startupProgress} />;
  }
  if (availability === null || availability?.status === "compatible") {
    return children;
  }
  if (availabilityQuery.isPending) {
    return isInspecting ? <RuntimeChecking /> : null;
  }
  return (
    <RuntimeSetup
      availability={availability ?? undefined}
      detectionFailed={availabilityQuery.isError}
      downloadProgress={downloadProgress}
      installFailed={installMutation.isError || startupProgress?.phase === "failed"}
      isInstalling={installMutation.isPending}
      onDownload={() => {
        // 等待原生 Channel 返回真实总量，避免预置的不定进度跳回 0%。
        setDownloadProgress(null);
        setStartupProgress(null);
        installMutation.mutate();
      }}
    />
  );
}

function RuntimeChecking() {
  const { t } = useTranslation("common");
  return (
    <main className="grid h-full place-items-center bg-window text-muted-foreground">
      <div className="flex items-center gap-2 text-sm" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t("runtimeSetup.checking")}
      </div>
    </main>
  );
}

function RuntimeUpdating({ progress }: Readonly<{ progress: CodexRuntimeInstallProgress }>) {
  const { t } = useTranslation("common");
  const percentage = updatePercentage(progress);
  const activeStep =
    progress.phase === "preparing" || progress.phase === "downloading"
      ? 0
      : progress.phase === "installing"
        ? 1
        : progress.phase === "ready"
          ? 2
          : -1;
  const steps = [
    { icon: Download, label: t("runtimeSetup.downloadPhase") },
    { icon: ShieldCheck, label: t("runtimeSetup.installPhase") },
    { icon: PackageCheck, label: t("runtimeSetup.updateReadyPhase") },
  ] as const;

  return (
    <main className="h-full overflow-y-auto bg-window text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-10 py-9">
        <img
          alt="Codexly"
          className="h-7 w-auto self-start"
          height="28"
          src="/brand/codexly-logo.svg"
          width="116"
        />
        <section
          aria-live="polite"
          className="my-auto w-full py-12"
          role="status"
        >
          <p className="text-xs font-semibold text-brand uppercase">
            {t("runtimeSetup.statusLabel")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {progress.phase === "failed"
              ? t("runtimeSetup.updateFailedTitle")
              : progress.currentVersion === null
                ? t("runtimeSetup.installTitle")
                : t("runtimeSetup.updateTitle")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {progress.phase === "failed"
              ? t("runtimeSetup.installFailed")
              : progress.phase === "ready"
                ? t("runtimeSetup.completingUpdate")
                : progress.currentVersion === null
                  ? t("runtimeSetup.installDescription")
                  : t("runtimeSetup.updateDescription")}
          </p>

          <div
            aria-label={t("runtimeSetup.versionTransition", {
              currentVersion: progress.currentVersion ?? "-",
              targetVersion: progress.targetVersion,
            })}
            className="mt-7 flex items-center gap-3 font-mono text-sm tabular-nums"
          >
            <span>{progress.currentVersion ?? "-"}</span>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold text-brand">{progress.targetVersion}</span>
          </div>

          <div className="mt-7 border-y border-separator py-6">
            <div className="grid grid-cols-3 gap-5">
              {steps.map(({ icon: Icon, label }, index) => {
                const completed = activeStep > index || progress.phase === "ready";
                const active = activeStep === index;
                return (
                  <div
                    className={`flex min-w-0 items-center gap-2 text-xs ${
                      active || completed ? "text-foreground" : "text-subtle-foreground"
                    }`}
                    key={label}
                  >
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full border ${
                        active || completed
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-separator-strong text-subtle-foreground"
                      }`}
                    >
                      {completed ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Icon className="size-3.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate font-medium">{label}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span>{t("runtimeSetup.updateProgress")}</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {progress.phase === "failed"
                    ? t("runtimeSetup.updateFailedTitle")
                    : percentage === null
                      ? t("runtimeSetup.preparingUpdate")
                      : `${percentage}%`}
                </span>
              </div>
              <div
                aria-label={t("runtimeSetup.updateProgress")}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percentage ?? undefined}
                className="h-1.5 overflow-hidden rounded-pill bg-control"
                role="progressbar"
              >
                {percentage !== null && percentage > 0 ? (
                  <div
                    className="h-full rounded-pill bg-brand transition-[width] duration-150"
                    style={{ width: `${percentage}%` }}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function updatePercentage(progress: CodexRuntimeInstallProgress): number | null {
  // 阶段切换不代表下载比例；总量未知时保持空条，只使用实际字节计算进度。
  if (progress.phase === "preparing" || progress.phase === "failed") return null;
  return calculateDownloadPercentage(progress);
}

type RuntimeSetupProps = Readonly<{
  availability: CodexRuntimeAvailability | undefined;
  detectionFailed: boolean;
  downloadProgress: CodexRuntimeInstallProgress | null;
  installFailed: boolean;
  isInstalling: boolean;
  onDownload: () => void;
}>;

function RuntimeSetup({
  availability,
  detectionFailed,
  downloadProgress,
  installFailed,
  isInstalling,
  onDownload,
}: RuntimeSetupProps) {
  const { t } = useTranslation("common");
  const requiredVersion = availability?.requiredVersion ?? "0.157.1";
  const failed = detectionFailed || availability?.status === "failed";

  return (
    <main className="h-full overflow-y-auto bg-window text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-10 py-9">
        <img
          alt="Codexly"
          className="h-7 w-auto self-start"
          height="28"
          src="/brand/codexly-logo.svg"
          width="116"
        />

        <section className="my-auto py-12" aria-labelledby="codex-runtime-title">
          <div className="flex items-start gap-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-danger/10 text-danger">
              <CircleAlert className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold text-danger uppercase">
                {t("runtimeSetup.statusLabel")}
              </p>
              <h1 id="codex-runtime-title" className="mt-1 text-2xl font-semibold">
                {installFailed
                  ? t("runtimeSetup.updateFailedTitle")
                  : failed
                    ? t("runtimeSetup.detectionFailedTitle")
                    : t("runtimeSetup.unsupportedTitle")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {availability?.status === "incompatible" &&
                availability.detectedVersion !== null
                  ? t("runtimeSetup.incompatibleDescription", {
                      detectedVersion: availability.detectedVersion,
                      requiredVersion,
                    })
                  : failed
                    ? t("runtimeSetup.detectionFailedDescription", { requiredVersion })
                    : t("runtimeSetup.missingDescription", { requiredVersion })}
              </p>
            </div>
          </div>

          <div className="mt-8 border-y border-separator">
            <RecoveryOption icon={<Download />} title={t("runtimeSetup.privateTitle")}>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("runtimeSetup.privateDescription", { requiredVersion })}
              </p>
              <Button
                className="mt-3"
                disabled={isInstalling}
                onClick={onDownload}
                type="button"
              >
                {isInstalling ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                {isInstalling ? t("runtimeSetup.downloading") : t("runtimeSetup.retryInstall")}
              </Button>
              {isInstalling && downloadProgress !== null ? (
                <RuntimeDownloadProgress progress={downloadProgress} />
              ) : null}
            </RecoveryOption>
          </div>

          {installFailed ? (
            <p className="mt-4 text-sm text-danger" role="alert">
              {t("runtimeSetup.installFailed")}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RuntimeDownloadProgress({
  progress,
}: Readonly<{ progress: CodexRuntimeInstallProgress }>) {
  const { t } = useTranslation("common");
  const percentage = updatePercentage(progress);
  const status =
    percentage === null
      ? t("runtimeSetup.downloadedBytes", { downloaded: formatBytes(progress.downloadedBytes) })
      : `${percentage}%`;
  const label =
    progress.phase === "installing"
      ? t("runtimeSetup.installPhase")
      : progress.phase === "ready"
        ? t("runtimeSetup.updateReadyPhase")
        : progress.phase === "preparing"
          ? t("runtimeSetup.preparingUpdate")
          : t("runtimeSetup.downloadProgress");

  return (
    <div className="mt-4 max-w-md" aria-live="polite">
      <div className="mb-1.5 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="shrink-0 font-mono tabular-nums">{status}</span>
      </div>
      <div
        aria-label={t("runtimeSetup.downloadProgress")}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percentage ?? undefined}
        className="h-1.5 overflow-hidden rounded-pill bg-control"
        role="progressbar"
      >
        {percentage !== null && percentage > 0 ? (
          <div
            className="h-full rounded-pill bg-brand transition-[width] duration-150"
            style={{ width: `${percentage}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function calculateDownloadPercentage(progress: CodexRuntimeInstallProgress): number | null {
  if (progress.totalBytes === null || progress.totalBytes <= 0) return null;
  return Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100));
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  const mebibytes = bytes / (1_024 * 1_024);
  if (mebibytes < 1) return `${Math.floor(bytes / 1_024)} KB`;
  return `${mebibytes.toFixed(1)} MB`;
}

type RecoveryOptionProps = Readonly<{
  children: ReactNode;
  icon: ReactNode;
  title: string;
}>;

function RecoveryOption({ children, icon, title }: RecoveryOptionProps) {
  return (
    <section className="grid grid-cols-[36px_1fr] gap-4 border-b border-separator py-5 last:border-b-0">
      <span className="mt-0.5 grid size-9 place-items-center rounded-control bg-control text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="mt-1">{children}</div>
      </div>
    </section>
  );
}
