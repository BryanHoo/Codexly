import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  checkCodexVersion,
  locateCodexBinary,
  type CodexBinary,
  type CodexVersionInfo,
} from "./binary.js";
import { JsonlRpcClient, RpcConnectionClosedError } from "./jsonl-rpc-client.js";
import { CODEX_OPT_OUT_NOTIFICATION_METHODS } from "./codex-mapping-common.js";

// 保留 Codex 对前向配置字段的默认兼容行为，避免 Desktop 与打包 CLI 的配置版本差异阻断启动。
const APP_SERVER_ARGUMENTS = ["app-server", "--listen", "stdio://"] as const;
const MAX_STDERR_LENGTH = 8_192;

export interface StartCodexAppServerOptions {
  appVersion?: string;
  binaryPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  rpcTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface CodexProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class CodexAppServerExitedError extends RpcConnectionClosedError {
  public readonly exitCode: number | null;
  public readonly signal: NodeJS.Signals | null;
  public readonly stderr: string;

  public constructor(exit: CodexProcessExit, stderr: string) {
    const reason = exit.signal ? `signal ${exit.signal}` : `code ${String(exit.code)}`;
    const detail = stderr ? `: ${stderr}` : "";
    super(`Codex App Server exited unexpectedly with ${reason}${detail}`);
    this.name = "CodexAppServerExitedError";
    this.exitCode = exit.code;
    this.signal = exit.signal;
    this.stderr = stderr;
  }
}

export class CodexAppServerSpawnError extends RpcConnectionClosedError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "CodexAppServerSpawnError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class CodexAppServerShutdownError extends RpcConnectionClosedError {
  public readonly timeoutMs: number;

  public constructor(timeoutMs: number) {
    super(`Codex App Server did not exit within ${String(timeoutMs)}ms after SIGKILL`);
    this.name = "CodexAppServerShutdownError";
    this.timeoutMs = timeoutMs;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

async function settledWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), delay(timeoutMs).then(() => false)]);
}

export class CodexAppServerProcess {
  public readonly binary: CodexBinary;
  public readonly client: JsonlRpcClient;
  public readonly version: CodexVersionInfo;

  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exitPromise: Promise<CodexProcessExit>;
  readonly #shutdownTimeoutMs: number;
  readonly #spawnPromise: Promise<void>;
  #closePromise: Promise<void> | null = null;
  #closed = false;
  #closing = false;
  #stderr = "";

  public constructor(
    child: ChildProcessWithoutNullStreams,
    binary: CodexBinary,
    version: CodexVersionInfo,
    options: { rpcTimeoutMs: number; shutdownTimeoutMs: number },
  ) {
    this.#child = child;
    this.binary = binary;
    this.version = version;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs;
    this.client = new JsonlRpcClient({
      closeOnInputEnd: false,
      defaultTimeoutMs: options.rpcTimeoutMs,
      input: child.stdout,
      output: child.stdin,
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      this.#appendStderr(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });

    this.#spawnPromise = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => {
        const spawnError = new CodexAppServerSpawnError(
          `Failed to start Codex App Server: ${error.message}`,
          { cause: error },
        );
        this.#closed = true;
        this.client.close(spawnError);
        reject(spawnError);
      });
    });

    // `exit` 早于 stdio 的 `close`，用于优先以进程退出原因 Reject Pending RPC。
    child.once("exit", (code, signal) => {
      if (!this.#closing) {
        this.client.close(new CodexAppServerExitedError({ code, signal }, this.#stderr.trim()));
      }
    });

    this.#exitPromise = new Promise<CodexProcessExit>((resolve) => {
      child.once("close", (code, signal) => {
        this.#closed = true;
        resolve({ code, signal });
      });
    });

    this.client.onError(() => {
      // 让 Client 先用原始协议错误 Reject Pending，再异步回收损坏的进程。
      queueMicrotask(() => {
        void this.close();
      });
    });
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public get pid(): number | undefined {
    return this.#child.pid;
  }

  public async waitForSpawn(): Promise<void> {
    await this.#spawnPromise;
  }

  public async waitForExit(): Promise<CodexProcessExit> {
    return this.#exitPromise;
  }

  public close(): Promise<void> {
    if (this.#closePromise) {
      return this.#closePromise;
    }
    this.#closePromise = this.#closeOnce();
    return this.#closePromise;
  }

  async #closeOnce(): Promise<void> {
    this.#closing = true;
    this.#closed = true;
    this.client.close(new RpcConnectionClosedError("Codex App Server is closing"));

    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.#exitPromise;
      return;
    }

    // 先关闭 stdin 请求正常退出，超时后再逐级终止，避免残留长驻进程。
    this.#child.stdin.end();
    if (await settledWithin(this.#exitPromise, this.#shutdownTimeoutMs)) {
      return;
    }
    this.#child.kill("SIGTERM");
    if (await settledWithin(this.#exitPromise, this.#shutdownTimeoutMs)) {
      return;
    }
    this.#child.kill("SIGKILL");
    if (!(await settledWithin(this.#exitPromise, this.#shutdownTimeoutMs))) {
      throw new CodexAppServerShutdownError(this.#shutdownTimeoutMs);
    }
  }

  #appendStderr(value: string): void {
    this.#stderr = `${this.#stderr}${value}`.slice(-MAX_STDERR_LENGTH);
  }
}

export async function startCodexAppServer(
  options: StartCodexAppServerOptions = {},
): Promise<CodexAppServerProcess> {
  const env = options.env ?? process.env;
  const binary = await locateCodexBinary({
    env,
    ...(options.binaryPath ? { explicitPath: options.binaryPath } : {}),
  });
  const version = await checkCodexVersion(binary.path);
  const child = spawn(binary.path, [...APP_SERVER_ARGUMENTS], {
    cwd: options.cwd,
    env: { ...env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const runtime = new CodexAppServerProcess(child, binary, version, {
    rpcTimeoutMs: options.rpcTimeoutMs ?? 30_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 2_000,
  });

  try {
    await runtime.waitForSpawn();
    await runtime.client.request("initialize", {
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: CODEX_OPT_OUT_NOTIFICATION_METHODS,
      },
      clientInfo: {
        name: "codexly",
        title: "Codexly",
        version: options.appVersion ?? "0.0.0",
      },
    });
    runtime.client.notify("initialized", {});
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
