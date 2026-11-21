import { AcpAgentCatalog } from "./agent-catalog.js";
import type { AgentEngine } from "@codexly/protocol";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import type { AcpAgentLauncher } from "./agent-launcher.js";
import { AcpProcess } from "./process.js";

const require = createRequire(import.meta.url);
/** 启动环境只复制一次；延迟创建的 agent 不受后续终端环境或代理设置变更影响。 */
export function createOfficialAcpLauncher(
  environment: NodeJS.ProcessEnv = process.env,
): AcpAgentLauncher {
  const snapshot = { ...environment };
  return async (engine, scope, callbacks) => {
    const name =
      engine === "codex"
        ? "@agentclientprotocol/codex-acp"
        : "@agentclientprotocol/claude-agent-acp";
    const manifest = require.resolve(`${name}/package.json`);
    const metadata = JSON.parse(await readFile(manifest, "utf8")) as {
      bin: string | Record<string, string>;
    };
    const entry = typeof metadata.bin === "string" ? metadata.bin : Object.values(metadata.bin)[0];
    if (!entry) throw new Error("ACP agent 未声明可执行入口");
    return AcpProcess.start(
      {
        command: process.execPath,
        args: [resolve(dirname(manifest), entry)],
        cwd: scope.rootPath,
        env: snapshot,
      },
      callbacks,
    );
  };
}

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
        name: initialized.info.name,
        protocolVersion: initialized.protocolVersion,
      });
    } finally {
      await handle.close();
    }
  }
  return profiles;
}
