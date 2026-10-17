import type { AgentEngine } from "@codexly/protocol";
import { invoke } from "../../../platform/tauri/native-invoke.js";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
const SharedEngineSetupGate = lazy(() => import("@codexly/ui/core/engine-setup-gate").then((module) => ({ default: module.EngineSetupGate })));
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import "../../../i18n/settings-provider.js";
import { nativeClient } from "../../projects/project-queries.js";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";
import { downloadAndInspectCodexRuntime } from "../../../platform/tauri/codex-runtime-manager.js";
import { CODEX_RUNTIME_QUERY_KEY } from "../codex-runtime-queries.js";
const CodexRuntimeGate = lazy(() => import("./codex-runtime-gate.js").then((module) => ({ default: module.CodexRuntimeGate })));

const ProviderConnectionPanel = lazy(() => import("../../provider-connection/components/provider-connection-panel.js").then((module) => ({ default: module.ProviderConnectionPanel })));
const ClaudeSettingsPanel = lazy(() => import("../../settings/components/claude-settings-panel.js").then((module) => ({ default: module.ClaudeSettingsPanel })));

export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("settings");
  const language = getCurrentLanguage();
  const [saved] = useState(() => readEngineSetup(appPreferenceStorage.getItem(ENGINE_SETUP_KEY)));
  // 已完成向导的启动不加载配置界面，保持工作区首屏依赖与内存占用有界。
  if (saved?.complete && !(import.meta.env.VITE_MACOS_LEGACY === "true" && saved.engines.includes("claude"))) return <SelectedEnginesContext value={saved.engines}><Suspense fallback={<p role="status">{t("provider.loading")}</p>}>{saved.engines.includes("codex") ? <CodexRuntimeGate>{children}</CodexRuntimeGate> : children}</Suspense></SelectedEnginesContext>;
  return <Suspense fallback={<p role="status">{t("provider.loading")}</p>}><SharedEngineSetupGate discover={() => invoke<AgentEngine[]>("get_configured_engines")} storage={appPreferenceStorage} language={language} claudeSupported={import.meta.env.VITE_MACOS_LEGACY !== "true"}
    prepare={async (engine, report) => {
      if (engine === "claude") {
        // 宿主按需解包应用内置资源；选择 Claude 不触发 Codex 检查或安装。
        report(language === "zh-CN" ? "正在准备" : "Preparing");
        await nativeClient.getClaudeSettings();
      } else {
        const availability = await downloadAndInspectCodexRuntime((progress) => {
          const percent = progress.totalBytes ? Math.min(100, Math.floor(progress.downloadedBytes / progress.totalBytes * 100)) : null;
          report(progress.phase === "downloading" ? `${language === "zh-CN" ? "正在下载" : "Downloading"} ${percent === null ? `${Math.floor(progress.downloadedBytes / 1024)} KB` : `${percent}%`}` : language === "zh-CN" ? "正在检查并安装" : "Checking and installing");
        });
        if (availability.status !== "compatible") throw new Error("Codex runtime unavailable");
        queryClient.setQueryData(CODEX_RUNTIME_QUERY_KEY, availability);
      }
    }}
    check={async (engine) => engine === "claude"
      ? (await nativeClient.getEngineProfile("claude")).connection.state === "connected"
      : (await nativeClient.getProviderConnection()).state === "connected"}
    renderConfiguration={(engine, actions) => <Suspense fallback={<p role="status">{t("provider.loading")}</p>}>
      {engine === "claude" ? <ClaudeSettingsPanel section="claude-provider" {...actions} /> : <ProviderConnectionPanel {...actions} />}
    </Suspense>}>
    {(engines) => engines.includes("codex") ? <CodexRuntimeGate>{children}</CodexRuntimeGate> : children}
  </SharedEngineSetupGate></Suspense>;
}
