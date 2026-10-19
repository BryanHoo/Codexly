import type { AgentEngine } from "@codexly/protocol";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EngineSettingsGate as SharedEngineSettingsGate } from "@codexly/ui/core/engine-settings-gate";
import { getCurrentLanguage } from "../../../i18n/i18n.js";
import { codexlyClient } from "../../projects/project-queries.js";

export function EngineSettingsGate({
  engine,
  children,
}: Readonly<{ engine: AgentEngine; children: ReactNode }>) {
  const queryClient = useQueryClient();
  const language = getCurrentLanguage();
  return (
    <SharedEngineSettingsGate
      engine={engine}
      language={language}
      download={false}
      prepare={async (report) => {
        // Web 使用服务端随应用安装的依赖，只验证可用性，不下载桌面宿主到浏览器。
        report(language === "zh-CN" ? "正在检查服务端运行环境" : "Checking server runtime");
        if (engine === "claude") await codexlyClient.getClaudeSettings();
        else await codexlyClient.getProviderConnection();
        await queryClient.invalidateQueries({ queryKey: ["provider-connection"] });
      }}
    >
      {children}
    </SharedEngineSettingsGate>
  );
}
