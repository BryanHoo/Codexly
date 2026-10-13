import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { ParsedCommandOptions } from "../cli-command-options.js";
import { createProcessShutdownSignal } from "../cli-shutdown.js";
import { createTerminalOutput, type TerminalOutput } from "../terminal-output.js";
import {
  type AutostartConfig,
  type AutostartPaths,
  ensurePrivateDirectory,
  isMissing,
  writePrivateJson,
} from "./config.js";
import { createLog, redact } from "./log.js";

export interface ManagedStartContext {
  options: ParsedCommandOptions;
  environment: NodeJS.ProcessEnv;
  background: true;
  signal: AbortSignal;
  output: TerminalOutput;
  onReady: (address: { host: string; port: number }) => Promise<void>;
}
export interface RuntimeState {
  pid: number;
  controlPort: number;
  token: string;
  startedAt: string;
  phase: "starting" | "ready" | "stopped" | "failed";
  lan: boolean;
  configHash: string;
  port?: number;
  error?: string;
}
export type PublicRuntime = Omit<RuntimeState, "token" | "controlPort">;
export function configHash(config: AutostartConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
export async function readRuntimeState(paths: AutostartPaths): Promise<RuntimeState | undefined> {
  try {
    const state = JSON.parse(await readFile(paths.state, "utf8")) as RuntimeState;
    if (
      !Number.isInteger(state.controlPort) ||
      state.controlPort < 1 ||
      state.controlPort > 65535 ||
      !/^[a-f0-9]{64}$/u.test(state.token)
    )
      return undefined;
    return state;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}
async function request(
  paths: AutostartPaths,
  action: "status" | "stop",
  overrideToken?: string,
): Promise<PublicRuntime | undefined> {
  const state = await readRuntimeState(paths);
  if (!state || !["starting", "ready"].includes(state.phase)) return undefined;
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: state.controlPort });
    let buffer = "";
    const finish = (value?: PublicRuntime): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500, () => {
      finish();
    });
    socket.on("error", () => {
      finish();
    });
    socket.on("end", () => {
      finish();
    });
    socket.on("connect", () =>
      socket.write(`${JSON.stringify({ token: overrideToken ?? state.token, action })}\n`),
    );
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      if (buffer.length > 8192) {
        finish();
        return;
      }
      if (!buffer.includes("\n")) return;
      try {
        const response = JSON.parse(buffer.trim()) as PublicRuntime;
        // 只信任能持有私有随机令牌的实例；旧 PID 被复用或端口被占用不会误报运行状态。
        if (response.pid !== state.pid || response.startedAt !== state.startedAt) {
          finish();
          return;
        }
        finish(response);
      } catch {
        finish();
      }
    });
  });
}
export function queryRuntime(
  paths: AutostartPaths,
  overrideToken?: string,
): Promise<PublicRuntime | undefined> {
  return request(paths, "status", overrideToken);
}
export async function stopManaged(paths: AutostartPaths): Promise<void> {
  const current = await request(paths, "stop");
  if (!current) return;
  const deadline = Date.now() + 20_000;
  // 仅用户主动停止期间短暂等待；正常运行没有状态轮询或额外管理进程。
  while (Date.now() < deadline) {
    if (!(await queryRuntime(paths))) return;
    await delay(100);
  }
  throw new Error("后台实例未在 20 秒内完成退出，请查看 autostart logs 后重试");
}

export async function runManaged(
  config: AutostartConfig,
  paths: AutostartPaths,
  start: (context: ManagedStartContext) => Promise<number>,
): Promise<number> {
  await ensurePrivateDirectory(paths.root);
  if (await queryRuntime(paths)) throw new Error("自启动实例已在运行，请使用 autostart restart");
  const log = await createLog(paths.log, config.start.lanPassword);
  const shutdown = createProcessShutdownSignal();
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  shutdown.signal.addEventListener("abort", abort, { once: true });
  const state: RuntimeState = {
    pid: process.pid,
    controlPort: 0,
    token: randomBytes(32).toString("hex"),
    startedAt: new Date().toISOString(),
    phase: "starting",
    lan: config.start.lan === true,
    configHash: configHash(config),
  };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(1500, () => socket.destroy());
    let buffer = "";
    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      if (buffer.length > 1024) return socket.destroy();
      if (!buffer.includes("\n")) return;
      try {
        const message = JSON.parse(buffer.trim()) as { token?: string; action?: string };
        const supplied = Buffer.from(typeof message.token === "string" ? message.token : "");
        const expected = Buffer.from(state.token);
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected) ||
          !["status", "stop"].includes(message.action ?? "")
        )
          return socket.destroy();
        const { token: _token, controlPort: _port, ...publicState } = state;
        socket.end(`${JSON.stringify(publicState)}\n`, () => {
          if (message.action === "stop") controller.abort();
        });
      } catch {
        socket.destroy();
      }
    });
  });
  server.maxConnections = 16;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    state.controlPort = (server.address() as { port: number }).port;
    await writePrivateJson(paths.state, state);
    const code = await start({
      options: { ...config.start, noOpen: true },
      environment: { ...process.env, ...config.environment },
      background: true,
      signal: controller.signal,
      output: createTerminalOutput(log.write, log.write, false),
      onReady: async ({ port }) => {
        state.phase = "ready";
        state.port = port;
        await writePrivateJson(paths.state, state);
      },
    });
    state.phase = code === 0 ? "stopped" : "failed";
    return code;
  } catch (error) {
    state.phase = "failed";
    state.error = redact(
      error instanceof Error ? error.message : String(error),
      config.start.lanPassword,
    );
    log.write(`[错误] ${state.error}`);
    return 1;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening)
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    shutdown.signal.removeEventListener("abort", abort);
    shutdown.cleanup();
    await writePrivateJson(paths.state, state);
    await log.flush();
  }
}
