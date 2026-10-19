import { EngineSelectionProvider } from "@codexly/ui/core/engine-selection-provider";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { browserSetupStorage } from "@codexly/ui/core/engine-selection";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
const SharedEngineSetupGate = lazy(() =>
  import("@codexly/ui/core/engine-setup-gate").then((module) => ({
    default: module.EngineSetupGate,
  })),
);
import { getCurrentLanguage, useTranslation } from "../../../i18n/i18n.js";
import { codexlyClient } from "../../projects/project-queries.js";

const ProviderConnectionPanel = lazy(() =>
  import("./provider-connection-panel.js").then((module) => ({
    default: module.ProviderConnectionPanel,
  })),
);
const ClaudeSettingsPanel = lazy(() =>
  import("../../settings/components/claude-settings-panel.js").then((module) => ({
    default: module.ClaudeSettingsPanel,
  })),
);

export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation("settings");
  const language = getCurrentLanguage();
  const [saved] = useState(() => readEngineSetup(browserSetupStorage.getItem(ENGINE_SETUP_KEY)));
  // 已完成向导的启动不加载配置界面，保持工作区首屏依赖与内存占用有界。
  if (saved?.complete)
    return (
      <EngineSelectionProvider engines={saved.engines} storage={browserSetupStorage}>
        {children}
      </EngineSelectionProvider>
    );
  return (
    <Suspense fallback={<p role="status">{t("provider.loading")}</p>}>
      <SharedEngineSetupGate
        discover={async () => {
          const results = await Promise.allSettled([
            codexlyClient.getProviderConnection(),
            codexlyClient.getEngineProfile("claude").then((profile) => profile.connection),
          ]);
          const engines = (["codex", "claude"] as const).filter((_, index) => {
            const result = results[index];
            return (
              result?.status === "fulfilled" &&
              (result.value.state === "connected" || Boolean(result.value.customBaseUrl))
            );
          });
          // 另一引擎不可用不阻塞已有用户；全部读取失败时显示重试，不能当作首次安装。
          if (!engines.length && results.some((result) => result.status === "rejected"))
            throw new Error("Settings unavailable");
          return engines;
        }}
        language={language}
        prepare={async (engine, report) => {
          // Web 引擎由服务端包提供；浏览器只检查选中的引擎，不重复下载桌面二进制。
          report(language === "zh-CN" ? "正在准备" : "Preparing");
          if (engine === "claude") await codexlyClient.getClaudeSettings();
          else await codexlyClient.getProviderConnection();
        }}
        check={async (engine) =>
          engine === "claude"
            ? (await codexlyClient.getEngineProfile("claude")).connection.state === "connected"
            : (await codexlyClient.getProviderConnection()).state === "connected"
        }
        renderConfiguration={(engine, actions) => (
          <Suspense fallback={<p role="status">{t("provider.loading")}</p>}>
            {engine === "claude" ? (
              <ClaudeSettingsPanel client={codexlyClient} section="claude-provider" {...actions} />
            ) : (
              <ProviderConnectionPanel {...actions} />
            )}
          </Suspense>
        )}
      >
        {children}
      </SharedEngineSetupGate>
    </Suspense>
  );
}
