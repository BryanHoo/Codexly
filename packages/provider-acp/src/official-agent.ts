import { AcpAgentCatalog } from "./agent-catalog.js";
import type { AgentEngine } from "@codexly/protocol";
import { join } from "node:path";
import { homedir } from "node:os";
import { AcpProcess } from "./process.js";

function agentCatalog(environment: NodeJS.ProcessEnv) {
  return new AcpAgentCatalog(
    join(environment["CODEXLY_HOME"] ?? join(homedir(), ".codexly"), "engines", "acp", "agents"),
  );
}

/** 版本来自 ACP 安装记录，读取过程不启动 Agent。 */
export async function readAcpEngineVersions(environment: NodeJS.ProcessEnv = process.env) {
  const { agents } = await agentCatalog(environment).list(false);
  const version = (engine: "codex" | "claude") =>
    agents.find((agent) => agent.engine === engine)?.installedVersion ?? null;
  return { codexVersion: version("codex") ?? "0.0.0", claudeVersion: version("claude") };
}

/** 显式诊断只做 ACP 握手，不创建会话、不执行 prompt，也不读取应用默认设置。 */
export async function inspectOfficialAcpAgents(environment: NodeJS.ProcessEnv) {
  const catalog = agentCatalog(environment);
  const profiles: { engine: AgentEngine; name: string; protocolVersion: number }[] = [];
  for (const { engine } of (await catalog.list(false)).agents.filter(
    (agent) => agent.installed && agent.enabled,
  )) {
    const cwd = homedir();
    const handle = await AcpProcess.start({
      ...(await catalog.command(engine)),
      cwd,
      env: environment,
    });
    try {
      const initialized = handle.connection.initialization;
      profiles.push({
        engine,
        name: initialized.agentInfo?.name ?? engine,
        protocolVersion: initialized.protocolVersion,
      });
    } finally {
      await handle.close();
    }
  }
  return profiles;
}
