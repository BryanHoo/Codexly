import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { AcpConnection, type AcpClientCallbacks } from "./connection.js";
import type { AcpAgentLaunchOptions } from "./agent-launcher.js";

export interface AcpProcessCommand {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

/** Web 与桌面宿主共用进程边界；厂商 agent 在进程内自行管理其 SDK 和原生历史。 */
export class AcpProcess {
  #closing: Promise<void> | undefined;

  private constructor(
    readonly connection: AcpConnection,
    readonly child: ChildProcessWithoutNullStreams,
    readonly exited: Promise<void>,
  ) {
    // 显式 close 调用仍返回清理错误；自动关闭分支接管拒绝，防止异常退出触发未处理 Promise。
    void connection.closed.then(() => this.close()).catch(() => undefined);
  }

  static async start(
    spec: AcpProcessCommand,
    callbacks: AcpClientCallbacks = {},
    options: AcpAgentLaunchOptions = {},
  ): Promise<AcpProcess> {
    options.signal?.throwIfAborted();
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      // POSIX 单独创建进程组，关闭时同时回收 adapter 启动的 agent 子进程。
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let startupError: Error | undefined;
    const exited = new Promise<void>((resolve) => {
      child.once("error", (error) => {
        startupError = error;
      });
      child.once("close", () => {
        resolve();
      });
    });
    // 持续排空 stderr，避免 agent 因管道背压卡住；原始输出可能含凭据，不进入业务事件或日志。
    const inspect = options.onStderrLine;
    if (inspect) {
      // 仅认证时识别有界的完整行，普通 stderr 不进入宿主诊断或业务日志。
      const lines = child.stderr.setEncoding("utf8");
      let pending = "";
      let discard = false;
      lines.on("data", (chunk: string) => {
        const parts = chunk.split("\n");
        const tail = parts.pop() ?? "";
        for (const part of parts) {
          if (!discard && pending.length + part.length <= 8192) inspect(pending + part);
          pending = "";
          discard = false;
        }
        if (!discard) {
          pending += tail;
          if (pending.length > 8192) {
            pending = "";
            discard = true;
          }
        }
      });
    } else child.stderr.resume();
    const cancelled = Promise.withResolvers<never>();
    const stop = () => {
      cancelled.reject(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    if (options.signal?.aborted) stop();
    try {
      const connecting = AcpConnection.connect(
        ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
        callbacks,
        options,
      );
      const connection = options.signal
        ? await Promise.race([connecting, cancelled.promise])
        : await connecting;
      return new AcpProcess(connection, child, exited);
    } catch (error) {
      await terminateAcpProcess(child, exited);
      throw startupError ?? error;
    } finally {
      options.signal?.removeEventListener("abort", stop);
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.connection.close();
      this.#closing = terminateAcpProcess(this.child, this.exited);
    }
    return this.#closing;
  }
}

/** 关闭使用有界等待并等待 close 排空管道；SIGTERM 无响应时强制回收，重复关闭复用同一 Promise。 */
export async function terminateAcpProcess(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<void>,
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    await exited;
    return;
  }
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exited;
      return;
    }
    // Windows 没有 POSIX 进程组，taskkill 的 /T 明确约束到本次创建的进程树。
    await new Promise<void>((resolve) => {
      const stop = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        shell: false,
      });
      stop.once("error", () => {
        child.kill();
        resolve();
      });
      stop.once("close", () => {
        resolve();
      });
    });
    await exited;
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      // macOS 在已确认退出的组长上可能返回 EPERM；不能覆盖原始握手失败。
      if (
        (error as NodeJS.ErrnoException).code === "EPERM" &&
        (child.exitCode !== null || child.signalCode !== null)
      )
        return;
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  try {
    signalGroup("SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    // 硬退出时管道 EOF 可先于 child.close，等待确认后才能忽略 macOS 的已退出组错误。
    const closed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, 1000);
      void exited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!closed) throw error;
  }
  const forced = Promise.withResolvers<undefined>();
  const force = setTimeout(() => {
    try {
      signalGroup("SIGKILL");
    } catch (error) {
      forced.reject(error);
    }
  }, 1_000);
  force.unref();
  try {
    await Promise.race([exited, forced.promise]);
  } finally {
    clearTimeout(force);
  }
  // 主 adapter 退出后，仍可能有忽略 SIGTERM 的后代，不能把它们遗留到下一次连接。
  try {
    signalGroup("SIGKILL");
  } catch (error) {
    // macOS 真实握手测试中，组长 close 已确认后可能返回 EPERM；运行中的权限错误仍向上传播。
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  }
}
