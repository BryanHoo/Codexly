import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { AcpAgentCatalog } from "./agent-catalog.js";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AcpProcess } from "./process.js";
import { methods } from "@agentclientprotocol/sdk/unstable";

/** 真实 adapter 仅握手，不创建会话或请求模型；用户目录及历史保持隔离。 */
describe.skipIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] !== "1")("官方 ACP adapter", () => {
  it.each(["codex", "claude"] as const)(
    "%s 稳定协议握手",
    async (engine) => {
      const root = await mkdtemp(join(tmpdir(), "codexly-official-acp-"));
      let agent: AcpProcess | undefined;
      try {
        const catalog = new AcpAgentCatalog(
          join(process.env["CODEXLY_HOME"] ?? join(homedir(), ".codexly"), "engines/acp/agents"),
        );
        // 集成测试通过应用登记的外部 ACP 命令握手。
        const command = await catalog.command(engine);
        await Promise.all([mkdir(join(root, "codex")), mkdir(join(root, "claude"))]);
        // 使用临时目录中的旧配置验证真实 agent 启动，绝不接触用户自己的凭据或配置。
        const preserved = [
          {
            path: join(root, "codex", "config.toml"),
            text: '# legacy comment\nmodel_reasoning_effort = "high"\n',
          },
          {
            path: join(root, "claude", "settings.json"),
            text: '{ "permissions": { "defaultMode": "default" } }\n',
          },
        ];
        await Promise.all(preserved.map((file) => writeFile(file.path, file.text)));
        agent = await AcpProcess.start({
          ...command,
          cwd: root,
          env: {
            CODEX_HOME: join(root, "codex"),
            CLAUDE_CONFIG_DIR: join(root, "claude"),
            ...command.env,
          },
        });
        expect(agent.connection.initialization.protocolVersion).toBe(1);
        expect(
          agent.connection.initialization.agentCapabilities?.sessionCapabilities,
        ).toBeDefined();
        expect(agent.connection.initialization.agentInfo?.name).toBeTruthy();
        expect(agent.connection.initialization.agentCapabilities?.sessionCapabilities).toBeTruthy();
        expect(agent.connection.initialization.agentCapabilities).toHaveProperty("providers");
        const page = await agent.connection.transport.agent.request(
          methods.agent.providers.list,
          {},
        );
        expect(page.providers.length).toBeGreaterThan(0);
        expect(page.providers.every((provider) => provider.supported.length > 0)).toBe(true);
        expect(agent.connection.initialization.agentCapabilities?.sessionCapabilities).toBeTruthy();
        const history = agent.connection.transport.agent.request(methods.agent.session.list, {});
        // 隔离环境没有账号；明确保留认证错误，不能将其当成“没有历史”。
        if (engine === "codex") await expect(history).rejects.toMatchObject({ code: -32000 });
        else expect((await history).sessions).toEqual([]);
        for (const file of preserved) expect(await readFile(file.path, "utf8")).toBe(file.text);
      } finally {
        await agent?.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
