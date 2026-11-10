import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AcpProcess } from "./process.js";

const roots: string[] = [];
const running: AcpProcess[] = [];
const workers: number[] = [];
afterEach(async () => {
  for (const pid of workers.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 清理已经退出的测试进程，无须再次发送信号。 */
    }
  }
  await Promise.all(running.splice(0).map((process) => process.close()));
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function script(source: string) {
  const root = await mkdtemp(join(tmpdir(), "codexly-acp-"));
  roots.push(root);
  const path = join(root, "agent.mjs");
  await writeFile(path, source);
  return { root, path };
}
const sdkUrl = import.meta.resolve("@agentclientprotocol/sdk");
const agentSource = `
import * as acp from ${JSON.stringify(sdkUrl)};
import {Readable,Writable} from "node:stream";
acp.agent({name:"fixture"})
 .onRequest(acp.methods.agent.initialize,()=>({protocolVersion:1,agentCapabilities:{loadSession:true}}))
 .onRequest(acp.methods.agent.session.new,()=>({sessionId:"native"}))
 .onRequest(acp.methods.agent.session.prompt,async({params,client})=>{
  await client.notify(acp.methods.client.session.update,{sessionId:params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"真实 stdio"}}});
  return {stopReason:"end_turn"};
 })
 .connect(acp.ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
`;

describe("ACP 子进程", () => {
  it.skipIf(process.platform === "win32")(
    "原生生命周期断开时回收独立 agent 及其后代进程组",
    async () => {
      const f = await script(
        `
import {connectAcpLifetime} from ${JSON.stringify(new URL("./process-lifetime.ts", import.meta.url).href)};
await connectAcpLifetime(process.env.CODEXLY_ACP_LIFETIME_SOCKET);
import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs";
const worker=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync("worker-pid",String(worker.pid));
` + agentSource,
      );
      const accepted = Promise.withResolvers<Socket>();
      const server = createServer((socket) => {
        accepted.resolve(socket);
      });
      const path = join(f.root, "lifetime.sock");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, resolve);
      });
      let socket: Socket | undefined;
      try {
        const agent = await AcpProcess.start({
          command: process.execPath,
          args: [f.path],
          cwd: f.root,
          env: { CODEXLY_ACP_LIFETIME_SOCKET: path },
        });
        running.push(agent);
        socket = await accepted.promise;
        const worker = Number(await readFile(join(f.root, "worker-pid"), "utf8"));
        workers.push(worker);
        socket.destroy();
        await expect.poll(() => agent.child.signalCode, { timeout: 2000 }).toBe("SIGKILL");
        await expect
          .poll(
            () => {
              try {
                process.kill(worker, 0);
                return false;
              } catch {
                return true;
              }
            },
            { timeout: 2000 },
          )
          .toBe(true);
      } finally {
        socket?.destroy();
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        });
      }
    },
  );
  it("通过官方 SDK 使用真实 stdio，关闭回收进程且幂等", async () => {
    const f = await script(agentSource);
    const updates: string[] = [];
    const process = await AcpProcess.start(
      { command: globalThis.process.execPath, args: [f.path], cwd: f.root },
      {
        onUpdate: ({ update }) => {
          updates.push(update.sessionUpdate);
        },
      },
    );
    running.push(process);
    const session = await process.connection.newSession({ cwd: f.root, mcpServers: [] });
    expect(
      await process.connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "你好" }],
      }),
    ).toEqual({ stopReason: "end_turn" });
    expect(updates).toEqual(["agent_message_chunk"]);
    const pid = process.pid;
    if (pid === undefined) throw new Error("子进程缺少 PID");
    await process.close();
    await process.close();
    expect(() => globalThis.process.kill(pid, 0)).toThrow();
  });

  it("握手超时终止无响应 agent", async () => {
    const f = await script(
      'import {writeFileSync} from "node:fs"; writeFileSync("pid",String(process.pid)); setInterval(()=>{},1000);',
    );
    await expect(
      AcpProcess.start(
        { command: process.execPath, args: [f.path], cwd: f.root },
        {},
        { handshakeTimeoutMs: 200 },
      ),
    ).rejects.toThrow("握手超时");
    const pid = Number(await readFile(join(f.root, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("启动失败和异常退出均拒绝等待，不启动替代 agent", async () => {
    await expect(
      AcpProcess.start({ command: "/nonexistent/codexly-agent", args: [], cwd: process.cwd() }),
    ).rejects.toThrow();
    const f = await script("process.exit(23)");
    await expect(
      AcpProcess.start({ command: process.execPath, args: [f.path], cwd: f.root }),
    ).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")("关闭时同时回收 agent 创建的子进程", async () => {
    const f = await script(
      `import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs";
const worker=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
writeFileSync("worker-pid",String(worker.pid));
` + agentSource,
    );
    const agent = await AcpProcess.start({
      command: process.execPath,
      args: [f.path],
      cwd: f.root,
    });
    running.push(agent);
    const pid = Number(await readFile(join(f.root, "worker-pid"), "utf8"));
    workers.push(pid);
    await agent.close();
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 2000 },
      )
      .toBe(true);
  });
});
