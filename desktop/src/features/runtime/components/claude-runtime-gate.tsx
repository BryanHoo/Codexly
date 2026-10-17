import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/shared/components/core/button.js";
import { prepareClaudeRuntime } from "../../../platform/tauri/claude-runtime-manager.js";
import type { CodexRuntimeInstallProgress } from "@/protocol/index.js";
import { getCurrentLanguage } from "../../../i18n/i18n.js";

/** 仅选用 Claude 时检查当前应用所需依赖；先完成更新再放行工作区，避免旧宿主接收新协议。 */
export function ClaudeRuntimeGate({ children }: Readonly<{ children: ReactNode }>) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<CodexRuntimeInstallProgress | null>(null);
  const chinese = getCurrentLanguage() === "zh-CN";
  useEffect(() => {
    let active = true;
    setFailed(false);
    setProgress(null);
    void prepareClaudeRuntime((value) => { if (active) setProgress(value); }).then(
      () => { if (active) setReady(true); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [attempt]);
  if (ready) return children;
  const percent = progress?.totalBytes ? Math.min(100, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)) : null;
  return <main className="grid h-full place-items-center bg-window text-foreground">
    <section className="max-w-md space-y-4 p-8" aria-live="polite" role={failed ? "alert" : "status"}>
      <h1 className="text-xl font-semibold">{chinese ? "准备 Claude" : "Preparing Claude"}</h1>
      <p className="text-sm text-muted-foreground">{failed
        ? (chinese ? "Claude 依赖下载或校验失败，请检查网络后重试。" : "Claude dependencies could not be downloaded or verified. Check your connection and retry.")
        : progress?.phase === "downloading"
          ? `${chinese ? "正在下载所需依赖" : "Downloading required dependencies"} ${percent === null ? `${Math.floor(progress.downloadedBytes / 1024)} KB` : `${percent}%`}`
          : (chinese ? "正在检查并更新所需版本，已安装的兼容依赖将直接复用。" : "Checking required versions and reusing compatible dependencies.")}</p>
      {progress?.phase === "downloading" && !failed ? <progress className="w-full" max={100} value={percent ?? undefined} aria-label={chinese ? "下载进度" : "Download progress"} /> : null}
      {failed ? <Button onClick={() => setAttempt((value) => value + 1)}>{chinese ? "重试" : "Retry"}</Button> : null}
    </section>
  </main>;
}
