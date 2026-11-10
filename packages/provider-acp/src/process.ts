import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk/unstable";
import { AcpConnection, type AcpClientCallbacks } from "./connection.js";

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
    options: { handshakeTimeoutMs?: number } = {},
  ): Promise<AcpProcess> {
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
    child.stderr.resume();
    try {
      const connection = await AcpConnection.connect(
        ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
        callbacks,
        options,
      );
      return new AcpProcess(connection, child, exited);
    } catch (error) {
      await terminate(child, exited);
      throw startupError ?? error;
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  close(): Promise<void> {
    if (!this.#closing) {
      this.connection.close();
      this.#closing = terminate(this.child, this.exited);
    }
    return this.#closing;
  }
}

/** 关闭使用有界等待并等待 close 排空管道；SIGTERM 无响应时强制回收，重复关闭复用同一 Promise。 */
async function terminate(
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
