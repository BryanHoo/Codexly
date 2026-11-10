import { isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { AcpHost } from "./host.js";
import { AcpProcess } from "./process.js";
import type { AcpAgentLauncher } from "./runtime.js";

export const ACP_HOST_VERSION = "codexly-acp-host/1";
/** 宿主与两个 agent 模式由同一独立程序供应；原生二进制仍由应用资源管理器校验。 */
export async function runAcpHost(
  args: readonly string[],
  io: { input: Readable; output: Writable; signal?: AbortSignal },
  launch?: AcpAgentLauncher,
): Promise<number> {
  if (args.length === 1 && args[0] === "--version") {
    io.output.write(`${ACP_HOST_VERSION}\n`);
    return 0;
  }
  const [directory, codex, claude] = args;
  if (args.length !== 3 || !directory || !codex || !claude || !args.every(isAbsolute))
    throw new Error("ACP 宿主需要数据目录及两个原生程序的绝对路径");
  io.signal?.throwIfAborted();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const launcher: AcpAgentLauncher =
    launch ??
    ((engine, scope, callbacks) =>
      AcpProcess.start(
        {
          command: process.execPath,
          args: ["--acp-agent", engine],
          cwd: scope.rootPath,
          env: engine === "codex" ? { CODEX_PATH: codex } : { CLAUDE_CODE_EXECUTABLE: claude },
        },
        callbacks,
      ));
  const host = new AcpHost(directory, io.output, launcher);
  return new Promise<number>((resolve, reject) => {
    let finishing = false;
    const finish = (code: number) => {
      if (finishing) return;
      finishing = true;
      io.input.off("data", data);
      io.input.off("end", end);
      io.input.off("error", failed);
      io.signal?.removeEventListener("abort", abort);
      io.input.pause();
      void host.close().then(() => {
        resolve(code);
      }, reject);
    };
    const data = (chunk: Buffer | string) => {
      host.receive(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      if (host.closed) finish(1);
    };
    const end = () => {
      finish(host.endInput() ? 0 : 1);
    };
    const failed = () => {
      finish(1);
    };
    const abort = () => {
      finish(0);
    };
    io.input.on("data", data);
    // stdout 故障可独立于 stdin 发生；宿主自行关闭时也必须结束入口等待。
    void host.finished.then(() => {
      finish(1);
    });
    io.input.once("end", end);
    io.input.once("error", failed);
    io.signal?.addEventListener("abort", abort, { once: true });
    if (io.signal?.aborted) abort();
  });
}
