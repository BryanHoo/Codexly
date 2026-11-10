import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AcpProcess } from "./process.js";
import { methods } from "@agentclientprotocol/sdk/unstable";

const require = createRequire(import.meta.url);
/** 真实 adapter 仅握手，不创建会话或请求模型；用户目录及历史保持隔离。 */
describe.skipIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] !== "1")("官方 ACP adapter", () => {
  it.each(["@agentclientprotocol/codex-acp", "@agentclientprotocol/claude-agent-acp"])(
    "%s 稳定协议握手",
    async (name) => {
      const root = await mkdtemp(join(tmpdir(), "codexly-official-acp-"));
      let agent: AcpProcess | undefined;
      let lifetime: Server | undefined;
      let lifetimeSocket: Socket | undefined;
      try {
        const manifest = require.resolve(`${name}/package.json`);
        const metadata = JSON.parse(await readFile(manifest, "utf8")) as {
          bin: Record<string, string>;
        };
        const entry = Object.values(metadata.bin)[0];
        if (!entry) throw new Error("官方包未声明 agent 入口");
        await Promise.all([mkdir(join(root, "codex")), mkdir(join(root, "claude"))]);
        const lifetimePath =
          process.env["CODEXLY_COMPILED_ACP_HOST"] && process.platform !== "win32"
            ? join(root, "lifetime.sock")
            : undefined;
        if (lifetimePath) {
          lifetime = createServer((socket) => {
            lifetimeSocket = socket;
          });
          await new Promise<void>((resolve, reject) => {
            lifetime?.once("error", reject);
            lifetime?.listen(lifetimePath, resolve);
          });
        }
        agent = await AcpProcess.start({
          command: process.env["CODEXLY_COMPILED_ACP_HOST"] ?? process.execPath,
          args: process.env["CODEXLY_COMPILED_ACP_HOST"]
            ? ["--acp-agent", name === "@agentclientprotocol/codex-acp" ? "codex" : "claude"]
            : [resolve(dirname(manifest), entry)],
          cwd: root,
          env: {
            CODEX_HOME: join(root, "codex"),
            CLAUDE_CONFIG_DIR: join(root, "claude"),
            ...(lifetimePath ? { CODEXLY_ACP_LIFETIME_SOCKET: lifetimePath } : {}),
          },
        });
        expect(agent.connection.initialization.protocolVersion).toBe(1);
        expect(agent.connection.initialization.agentCapabilities?.loadSession).toBe(true);
        expect(agent.connection.initialization.agentInfo?.name).toBeTruthy();
        expect(
          agent.connection.initialization.agentCapabilities?.sessionCapabilities?.close,
        ).toBeTruthy();
        expect(agent.connection.initialization.agentCapabilities).toHaveProperty("providers");
        const page = await agent.connection.transport.agent.request(
          methods.agent.providers.list,
          {},
        );
        expect(page.providers.length).toBeGreaterThan(0);
        expect(page.providers.every((provider) => provider.supported.length > 0)).toBe(true);
        expect(
          agent.connection.initialization.agentCapabilities?.sessionCapabilities?.list,
        ).toBeTruthy();
        const history = agent.connection.transport.agent.request(methods.agent.session.list, {});
        // 隔离环境没有账号；明确保留认证错误，不能将其当成“没有历史”。
        if (name === "@agentclientprotocol/codex-acp")
          await expect(history).rejects.toMatchObject({ code: -32000 });
        else expect((await history).sessions).toEqual([]);
        if (lifetimePath) {
          await expect.poll(() => lifetimeSocket !== undefined).toBe(true);
          lifetimeSocket?.destroy();
          await expect.poll(() => agent?.child.signalCode).toBe("SIGKILL");
        }
      } finally {
        await agent?.close();
        lifetimeSocket?.destroy();
        if (lifetime)
          await new Promise<void>((resolve) => {
            lifetime?.close(() => {
              resolve();
            });
          });
        await rm(root, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
