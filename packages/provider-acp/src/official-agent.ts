import { AcpAgentCatalog } from "./agent-catalog.js";
import type { AgentEngine } from "@codexly/protocol";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { AcpProcess } from "./process.js";

const require = createRequire(import.meta.url);
/** 只读官方 adapter 实际依赖的元数据；版本展示不启动模型或依赖应用旧 SDK。 */
export async function readAcpEngineVersions(): Promise<{
  codexVersion: string;
  claudeVersion: string;
}> {
  const read = async (engine: "codex" | "claude") => {
    try {
      const adapter = createRequire(
        require.resolve(
          `${engine === "codex" ? "@agentclientprotocol/codex-acp" : "@agentclientprotocol/claude-agent-acp"}/package.json`,
        ),
      );
      const metadata = JSON.parse(
        await readFile(
          engine === "codex"
            ? adapter.resolve("@openai/codex/package.json")
            : new URL(
                "./package.json",
                pathToFileURL(adapter.resolve("@anthropic-ai/claude-agent-sdk")),
              ),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const version = metadata[engine === "codex" ? "version" : "claudeCodeVersion"];
      if (typeof version !== "string") throw new Error("ACP 原生版本元数据无效");
      return version;
    } catch (error) {
      if (["MODULE_NOT_FOUND", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return "未安装";
      throw error;
    }
  };
  const [codexVersion, claudeVersion] = await Promise.all([read("codex"), read("claude")]);
  return { codexVersion, claudeVersion };
}

/** 显式诊断只做 ACP 握手，不创建会话、不执行 prompt，也不读取应用默认设置。 */
export async function inspectOfficialAcpAgents(environment: NodeJS.ProcessEnv) {
  const catalog = new AcpAgentCatalog(
    join(environment["CODEXLY_HOME"] ?? join(homedir(), ".codexly"), "engines", "acp", "agents"),
  );
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
