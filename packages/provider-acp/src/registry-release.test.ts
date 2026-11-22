import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import snapshot from "./registry-snapshot.json" with { type: "json" };
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
import { AcpProcess } from "./process.js";

const require = createRequire(import.meta.url);
const registry: RegistryAgent[] = snapshot.agents;
const official = registry.filter((agent) => ["codex-acp", "claude-acp"].includes(agent.id));

it("官方开发依赖与目录安装版本保持一致", async () => {
  expect(official).toHaveLength(2);
  for (const agent of official) {
    const spec = agent.distribution.npx?.package;
    if (!spec) throw new Error("官方目录缺少 npm 分发");
    const name = spec.slice(0, spec.lastIndexOf("@"));
    const manifest = JSON.parse(
      await readFile(require.resolve(`${name}/package.json`), "utf8"),
    ) as { version: string };
    expect(manifest.version, `${agent.id} 的开发依赖版本落后于目录`).toBe(agent.version);
    expect(spec).toBe(`${name}@${agent.version}`);
  }
});

// 发布门禁从快照安装真实固定版本；不允许编译宿主或开发依赖替代被测安装产物。
describe.skipIf(process.env["CODEXLY_REGISTRY_RELEASE_TEST"] !== "1")("目录发布安装与握手", () => {
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
  for (const agent of official) {
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
            env: { ...installed.env, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude },
          });
          expect(handle.connection.initialization.protocolVersion).toBe(1);
          expect(handle.connection.initialization.agentInfo?.name).toBeTruthy();
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
