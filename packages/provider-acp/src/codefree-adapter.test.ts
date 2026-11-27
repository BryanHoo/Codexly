import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { launchCatalogAgent } from "./codefree-adapter.js";
import { CodefreeOutput } from "./codefree-turn.js";

it("事件增量和最终快照只投影一次", async () => {
  const chunks: string[] = [];
  const output = new CodefreeOutput((update) => {
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
      chunks.push(update.content.text);
    return Promise.resolve();
  });
  const part = {
    id: "p",
    type: "text",
    text: "",
    messageID: "m",
    tool: "",
    callID: "",
    state: { status: "" },
  };
  await output.part(part);
  await output.delta("p", "你");
  await output.part({ ...part, text: "你好" });
  await output.part({ ...part, text: "你好" });
  expect(chunks).toEqual(["你", "好"]);
});

// 真实账号检查按需启用，普通测试和发布构建均不访问企业模型。
it.skipIf(process.env["CODEXLY_CODEFREE_LIVE"] !== "1")(
  "原生服务完成首轮并重放同一会话",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codexly-codefree-"));
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const chunks: string[] = [],
      replayed: string[] = [];
    const handle = await launchCatalogAgent(
      "acp-codefree-o",
      {
        command: "codefree-o",
        args: ["serve"],
        cwd,
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            command: {
              codexlycheck: { template: "只回复 OK。请勿调用工具。", description: "测试命令" },
            },
          }),
        },
      },
      {
        onUpdate: ({ update }, historical) => {
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
            (historical ? replayed : chunks).push(update.content.text);
        },
      },
    );
    try {
      const handshake = elapsed();
      const connection = handle.connection;
      const { sessionId, configOptions } = await connection.newSession({ cwd, mcpServers: [] });
      const ready = elapsed();
      const model = configOptions.find((o) => o.id === "model");
      expect(model?.type).toBe("select");
      const selected =
        process.env["CODEXLY_CODEFREE_TEST_MODEL"] ?? "codefree/DeepSeek-V4.1-Flash-1017";
      const changed = await connection.setConfigOption(sessionId, "model", selected);
      expect(changed.configOptions.find((o) => o.id === "model")?.currentValue).toBe(selected);
      expect(configOptions.map((o) => o.id)).toContain("model");
      const result = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: "只回复 OK。请勿调用工具。" }],
      });
      const complete = elapsed();
      expect(result.stopReason).toBe("end_turn");
      expect(chunks.join("").trim()).toContain("OK");
      await connection.closeSession(sessionId);
      await connection.resumeSession({ cwd, sessionId }, true);
      expect(replayed.join("")).toBe(chunks.join(""));
      const second = await connection.newSession({ cwd, mcpServers: [] });
      const listed = await connection.transport.agent.request(acp.methods.agent.session.list, {
        cwd,
      });
      expect(listed.sessions.map((s) => s.sessionId)).toContain(second.sessionId);
      await vi.waitFor(
        () => {
          expect(
            connection
              .readSessionState(second.sessionId)
              .availableCommands.some((c) => c.name === "codexlycheck"),
          ).toBe(true);
        },
        { timeout: 90000 },
      );
      const warm = elapsed();
      await connection.prompt({
        sessionId: second.sessionId,
        prompt: [{ type: "text", text: "/codexlycheck" }],
      });
      expect(chunks.join("").trim()).toMatch(/OK[\s\S]*OK/);
      const compact = await connection.prompt({
        sessionId: second.sessionId,
        prompt: [{ type: "text", text: "/compact" }],
      });
      expect(compact.stopReason).toBe("end_turn");
      await connection.deleteSession(second.sessionId);
      await connection.deleteSession(sessionId);
      console.info({ handshake, ready, complete, warmCommandAndCompaction: elapsed() - warm });
    } finally {
      await handle.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
  210000,
);

// 使用最小 stdio MCP 对端验证企业 CLI 的真实注册结果，关闭后再次恢复原生会话。
it.skipIf(process.env["CODEXLY_CODEFREE_LIVE"] !== "1")(
  "隔离会话的 stdio 和 HTTP MCP、附加目录和分支",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "codefree-mcp-"));
    const extra = await mkdtemp(join(tmpdir(), "codefree-extra-"));
    // HTTP 和 stdio 服务都只向本次测试会话提供空工具目录。
    const http = createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      let body = "";
      req.setEncoding("utf8").on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        const rpc = JSON.parse(body) as {
          id?: number;
          method: string;
          params?: { protocolVersion: string };
        };
        if (rpc.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        const result =
          rpc.method === "initialize"
            ? {
                protocolVersion: rpc.params?.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: "http-fixture", version: "1" },
              }
            : { tools: [] };
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      });
    });
    await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("测试 MCP 地址无效");
    const handle = await launchCatalogAgent("acp-codefree-o", {
      command: "codefree-o",
      args: ["serve"],
      cwd,
    });
    try {
      const peer = `require("node:readline").createInterface({input:process.stdin}).on("line",line=>{
      const q=JSON.parse(line);if(q.id===undefined)return;
      const result=q.method==="initialize"?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"local-fixture",version:"1"}}:{tools:[]};
      console.log(JSON.stringify({jsonrpc:"2.0",id:q.id,result}));
    });`;
      const { connection } = handle;
      const session = await connection.newSession({
        cwd,
        additionalDirectories: [extra],
        mcpServers: [
          { name: "codexlytest", command: process.execPath, args: ["-e", peer], env: [] },
          {
            type: "http",
            name: "codexlyhttp",
            url: "http://127.0.0.1:" + String(address.port),
            headers: [],
          },
        ],
      });
      await connection.closeSession(session.sessionId);
      await expect(
        connection.resumeSession({ cwd: extra, sessionId: session.sessionId }),
      ).rejects.toThrow();
      await connection.resumeSession({ cwd, sessionId: session.sessionId, mcpServers: [] });
      const fork = await connection.forkSession({
        cwd,
        sessionId: session.sessionId,
        mcpServers: [],
      });
      expect(fork).not.toBe(session.sessionId);
      await connection.deleteSession(fork);
      await connection.deleteSession(session.sessionId);
    } finally {
      await handle.close();
      http.close();
      await Promise.all([
        rm(cwd, { recursive: true, force: true }),
        rm(extra, { recursive: true, force: true }),
      ]);
    }
  },
  120000,
);
