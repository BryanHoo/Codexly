import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AcpDefaults, AgentEngine } from "@codexly/protocol";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
import { createAcpEngineSetupStorage } from "@codexly/frontend-core/acp-engine-setup";
import type { AcpAuthClient } from "./acp-auth-settings.js";
import { EngineSetupGate } from "./engine-setup-gate.js";
import { EngineSelectionProvider } from "./engine-selection-provider.js";
import { browserSetupStorage, type SetupStorage } from "./engine-selection.js";
import { Button } from "./button.js";

const AuthSettings = lazy(() =>
  import("./acp-auth-settings.js").then((module) => ({ default: module.AcpAuthSettings })),
);
export interface AcpEngineSetupClient extends AcpAuthClient {
  getAcpDefaults: (engine: AgentEngine) => Promise<AcpDefaults>;
}

export function AcpEngineSetupGate({
  children,
  client,
  language,
  claudeSupported = true,
  storage = browserSetupStorage,
}: Readonly<{
  children: ReactNode;
  client: AcpEngineSetupClient;
  language: string;
  claudeSupported?: boolean;
  storage?: SetupStorage;
}>) {
  const cache = useQueryClient();
  const privateStorage = useMemo(() => createAcpEngineSetupStorage(storage), [storage]);
  const [saved] = useState(() => readEngineSetup(privateStorage.getItem(ENGINE_SETUP_KEY)));
  const engines = saved?.engines.filter((engine) => engine === "codex" || claudeSupported);
  // 已完成的用户直接进入工作区，不重新启动智能体、认证或设置会话。
  if (saved?.complete && engines?.length)
    return (
      <EngineSelectionProvider engines={engines} storage={privateStorage}>
        {children}
      </EngineSelectionProvider>
    );
  return (
    <EngineSetupGate
      language={language}
      storage={privateStorage}
      claudeSupported={claudeSupported}
      discover={() => Promise.resolve([])}
      prepare={async (engine) => {
        const profile = await client.getAcpAgent(engine);
        if (profile.engine !== engine) throw new Error("ACP engine mismatch");
        cache.setQueryData(["acp-agent-profile", engine], profile);
      }}
      check={async (engine) => {
        // 握手或认证回执不足以证明可用；用户确认后才创建、校验并关闭设置会话。
        const defaults = await client.getAcpDefaults(engine);
        cache.setQueryData(["acp-defaults", engine], defaults);
        return true;
      }}
      renderConfiguration={(engine, actions) => (
        <Suspense
          fallback={
            <p role="status">{language.startsWith("zh") ? "正在读取配置…" : "Loading settings…"}</p>
          }
        >
          <AuthSettings
            key={engine}
            client={client}
            engine={engine}
            language={language.startsWith("zh") ? "zh-CN" : "en"}
          />
          <Button className="mt-5 w-full" onClick={actions.onConnected}>
            {actions.continueLabel}
          </Button>
        </Suspense>
      )}
    >
      {children}
    </EngineSetupGate>
  );
}
