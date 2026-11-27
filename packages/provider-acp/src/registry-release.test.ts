import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import snapshot from "./registry-snapshot.json" with { type: "json" };
import { codefreeAgent } from "./agent-registry.js";
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
import { AcpProcess } from "./process.js";

const registry: RegistryAgent[] = snapshot.agents;
const official = registry.filter((agent) => ["codex-acp", "claude-acp"].includes(agent.id));

it("官方 Agent 的 npm 分发固定为目录版本", () => {
  expect(official).toHaveLength(2);
  for (const agent of official) {
    const spec = agent.distribution.npx?.package;
    if (!spec) throw new Error("官方目录缺少 npm 分发");
    const name = spec.slice(0, spec.lastIndexOf("@"));
    expect(spec).toBe(`${name}@${agent.version}`);
  }
});

// 发布门禁从快照安装真实固定版本；不允许编译宿主或开发依赖替代被测安装产物。
describe.skipIf(process.env["CODEXLY_REGISTRY_RELEASE_TEST"] !== "1")("目录发布安装与握手", () => {
  it("codefree-o 在当前平台安装原生入口并执行版本检查", async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-codefree-release-"));
    try {
      // 厂商安装脚本会配置用户运行时。测试将运行时隔离，首次登录留给真实账号流程。
      const env = { ...process.env, OPENCODE_TEST_HOME: root };
      const installed = await installRegistryAgent(codefreeAgent, join(root, "runtime"), env);
      expect(installed.args).toEqual(["acp"]);
      const result = await promisify(execFile)(installed.command, ["--version"], {
        env,
        cwd: root,
        timeout: 30_000,
        windowsHide: true,
      });
      expect(result.stdout.trim()).toBe(codefreeAgent.version);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);
  it.skipIf(process.platform !== "linux").each(["junie", "antigravity-acp"])(
    "%s Linux ZIP 真实安装",
    async (id) => {
      const root = await mkdtemp(join(tmpdir(), "acp-registry-zip-"));
      try {
        const agent = registry.find((entry) => entry.id === id);
        if (!agent) throw new Error("目录缺少 ZIP 测试条目");
        const installed = await installRegistryAgent(agent, join(root, "runtime"));
        expect((await stat(installed.command)).isFile()).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    300_000,
  );
  const peers = registry.filter((agent) =>
    ["opencode-v2", "gemini", "qwen-code", "github-copilot-cli"].includes(agent.id),
  );
  for (const agent of [...official, ...peers]) {
    it.each((["npx", "binary"] as const).filter((kind) => agent.distribution[kind]))(
      `${agent.id}@${agent.version} %s 安装后握手`,
      async (kind) => {
        const root = await mkdtemp(join(tmpdir(), "acp-registry-release-"));
        let handle: AcpProcess | undefined;
        try {
          const distribution = { [kind]: agent.distribution[kind] };
          expect(distribution[kind]).toBeDefined();
          const installed = await installRegistryAgent(
            { ...agent, distribution },
            join(root, "runtime"),
          );
          const codex = join(root, "codex");
          const claude = join(root, "claude");
          await Promise.all([mkdir(codex), mkdir(claude)]);
          handle = await AcpProcess.start({
            ...installed,
            cwd: root,
            env: {
              ...installed.env,
              CODEX_HOME: codex,
              CLAUDE_CONFIG_DIR: claude,
              XDG_CONFIG_HOME: join(root, "config"),
              XDG_DATA_HOME: join(root, "data"),
              XDG_STATE_HOME: join(root, "state"),
              XDG_CACHE_HOME: join(root, "cache"),
            },
          });
          expect(handle.connection.initialization.protocolVersion).toBe(1);
          expect(handle.connection.initialization.agentInfo?.name).toBeTruthy();
          // 基础 v1 Agent 可以省略可选能力；第三方握手只校验稳定版本与身份。
          if (official.includes(agent))
            expect(
              handle.connection.initialization.agentCapabilities?.sessionCapabilities,
            ).toBeDefined();
        } finally {
          await handle?.close();
          await rm(root, { recursive: true, force: true });
        }
      },
      300_000,
    );
  }
});
