import { agentEngineName } from "@codexly/protocol";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AcpAgentProfile, AgentEngine } from "@codexly/protocol";
import { EngineSettingsGate } from "./engine-settings-gate.js";

interface Client {
  getAcpAgent: (engine: AgentEngine) => Promise<AcpAgentProfile>;
}

/** 仅为旧版无目录客户端保留准备流程。 */
export function AcpEngineSettingsGate({
  client,
  engine,
  language,
  children,
}: Readonly<{
  client: Partial<Client>;
  engine: AgentEngine;
  language: string;
  children: ReactNode;
}>) {
  const cache = useQueryClient();
  const chinese = language.startsWith("zh");
  const name = agentEngineName(engine);
  return (
    <EngineSettingsGate
      engine={engine}
      language={language}
      download={false}
      messages={{
        description: chinese
          ? `尚未启用 ${name}。准备完成后即可配置认证和供应商。`
          : `${name} is not enabled. Prepare it before configuring sign-in and providers.`,
        failure: chinese ? "准备失败，请重试。" : "Preparation failed. Try again.",
      }}
      prepare={async (report) => {
        report(chinese ? "正在检查智能体…" : "Checking agent…");
        const inspect = client.getAcpAgent;
        if (!inspect) throw new Error("ACP preparation is unavailable");
        const profile = await inspect.call(client, engine);
        if (profile.engine !== engine) throw new Error("ACP engine mismatch");
        // 使用同一引擎的已协商能力，打开认证页不需要再次握手或创建会话。
        cache.setQueryData(["acp-agent-profile", engine], profile);
      }}
    >
      {children}
    </EngineSettingsGate>
  );
}
