import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { Agent, fetch } from "undici";
import { AcpAuthenticationRequiredError } from "@codexly/core";
import type { AcpAgentLaunchOptions } from "./agent-launcher.js";
import { terminateAcpProcess, type AcpProcessCommand } from "./process.js";

/** 环回服务仅由当前宿主持有；随机密码不经过命令行，HTTP 不使用用户的出站代理。 */
export async function startCodefreeServer(
  spec: AcpProcessCommand,
  options: AcpAgentLaunchOptions,
): Promise<CodefreeServer> {
  options.signal?.throwIfAborted();
  const password = randomBytes(32).toString("hex");
  const authorization = "Basic " + Buffer.from("codexly:" + password).toString("base64");
  // 支持 node launcher.js 等包装命令。旧配置里的 acp 子命令在启动边界截断。
  const index = spec.args.findIndex((arg) => arg === "acp" || arg === "serve");
  const prefix = index < 0 ? spec.args : spec.args.slice(0, index);
  const child = spawn(
    spec.command,
    [...prefix, "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: spec.cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: {
        ...process.env,
        ...spec.env,
        OPENCODE_SERVER_USERNAME: "codexly",
        OPENCODE_SERVER_PASSWORD: password,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const ready = Promise.withResolvers<string>();
  const life = new AbortController();
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => {
      const error = new Error("CodeFree O 服务已退出");
      life.abort(error);
      ready.reject(error);
      resolve();
    }),
  );
  child.once("error", ready.reject);
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const match = /listening on (http:\/\/127\.0\.0\.1:\d+)\s*$/i.exec(line);
    if (match?.[1]) ready.resolve(match[1]);
  });
  const dispatcher = new Agent();
  let closing: Promise<void> | undefined;
  const close = () => {
    life.abort();
    return (closing ??= Promise.all([
      terminateAcpProcess(child, exited),
      dispatcher.destroy(),
    ]).then(() => undefined));
  };
  const deadline = AbortSignal.timeout(options.handshakeTimeoutMs ?? 30_000);
  const startup = AbortSignal.any([
    life.signal,
    deadline,
    ...(options.signal ? [options.signal] : []),
  ]);
  const abort = () => {
    ready.reject(startup.reason);
  };
  startup.addEventListener("abort", abort, { once: true });
  try {
    const base = await ready.promise;
    const request = async (
      path: string,
      cwd: string,
      body?: unknown,
      signal = life.signal,
      method = body === undefined ? "GET" : "POST",
    ) => {
      const url = new URL(path, base);
      if (cwd) url.searchParams.set("directory", cwd);
      const response = await fetch(url, {
        dispatcher,
        redirect: "error",
        method,
        headers: { authorization, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([life.signal, signal]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (method === "DELETE" && response.status === 404) return response;
        throw new Error(`CodeFree O ${url.pathname} 返回 HTTP ${String(response.status)}`);
      }
      return response;
    };
    const json = async <T>(path: string, cwd: string, body?: unknown, signal?: AbortSignal) =>
      (await (await request(path, cwd, body, signal)).json()) as T;
    const health = await json<{ version: string }>("/global/health", spec.cwd, undefined, startup);
    interface Status {
      authenticated: boolean;
      login?: { state: string; authUrl?: string };
    }
    let auth = await json<Status>("/codefree/auth/status", spec.cwd, undefined, startup);
    if (!auth.authenticated && options.codefreeLogin) {
      auth = await json<Status>("/codefree/auth/login", spec.cwd, {}, startup);
      while (!auth.authenticated && auth.login?.state === "running") {
        if (auth.login.authUrl) options.onStderrLine?.(auth.login.authUrl);
        await sleep(400, undefined, { signal: startup });
        auth = await json<Status>("/codefree/auth/status", spec.cwd, undefined, startup);
      }
    }
    if (!auth.authenticated) throw new AcpAuthenticationRequiredError();
    return { request, json, version: health.version, close, exited, signal: life.signal };
  } catch (error) {
    await close();
    throw error;
  } finally {
    startup.removeEventListener("abort", abort);
  }
}
export interface CodefreeServer {
  request(
    path: string,
    cwd: string,
    body?: unknown,
    signal?: AbortSignal,
    method?: string,
  ): Promise<Awaited<ReturnType<typeof fetch>>>;
  json<T>(path: string, cwd: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  readonly version: string;
  readonly exited: Promise<void>;
  readonly signal: AbortSignal;
  close(): Promise<void>;
}
