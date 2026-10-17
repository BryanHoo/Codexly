import type { AgentEngine } from "@codexly/protocol";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EngineSettingsGate as SharedEngineSettingsGate } from "@codexly/ui/core/engine-settings-gate";
import { getCurrentLanguage } from "../../../i18n/i18n.js";
import { prepareClaudeRuntime } from "../../../platform/tauri/claude-runtime-manager.js";
import { downloadAndInspectCodexRuntime } from "../../../platform/tauri/codex-runtime-manager.js";
import { ensureCodexRuntime } from "../../../platform/tauri/runtime.js";
import { CODEX_RUNTIME_QUERY_KEY } from "../../runtime/codex-runtime-queries.js";
import type { CodexRuntimeInstallProgress } from "../../../protocol/index.js";

export function EngineSettingsGate({
  engine,
  children,
}: Readonly<{ engine: AgentEngine; children?: ReactNode }>) {
  const client = useQueryClient();
  const language = getCurrentLanguage();
  const chinese = language === "zh-CN";
  if (engine === "claude" && import.meta.env.VITE_MACOS_LEGACY === "true")
    return (
      <p role="status">
        {chinese ? "此系统版本不支持 Claude。" : "Claude is not supported on this system version."}
      </p>
    );
  return (
    <SharedEngineSettingsGate
      engine={engine}
      language={language}
      download
      prepare={async (report) => {
        const onProgress = (progress: CodexRuntimeInstallProgress) => {
          const percent = progress.totalBytes
            ? Math.min(100, Math.floor((progress.downloadedBytes / progress.totalBytes) * 100))
            : null;
          report(
            progress.phase === "downloading"
              ? `${chinese ? "正在下载" : "Downloading"} ${percent === null ? `${Math.floor(progress.downloadedBytes / 1024)} KB` : `${percent}%`}`
              : chinese
                ? "正在检查并安装"
                : "Checking and installing",
          );
        };
        if (engine === "claude") await prepareClaudeRuntime(onProgress);
        else {
          const availability = await downloadAndInspectCodexRuntime(onProgress);
          if (availability.status !== "compatible") throw new Error("Codex runtime unavailable");
          client.setQueryData(CODEX_RUNTIME_QUERY_KEY, availability);
          // 安装成功后建立 Codex 连接，避免首次配置查询仍读到先前的缺失运行时错误。
          await ensureCodexRuntime();
          await Promise.all(
            ["provider-connection", "models", "settings"].map((key) =>
              client.invalidateQueries({ queryKey: [key] }),
            ),
          );
        }
      }}
    >
      {children}
    </SharedEngineSettingsGate>
  );
}
