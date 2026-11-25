import { isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { AcpHost } from "./host.js";
import type { AcpAgentLauncher } from "./runtime.js";
import {
  readAcpLegacyApplicationSettings,
  readAcpLegacyApplicationPreferences,
} from "./legacy-settings.js";

export const ACP_HOST_VERSION = "codexly-acp-host/1";
/** 共享宿主由应用装配，具体 Agent 由 ACP 目录提供。 */
export async function runAcpHost(
  args: readonly string[],
  io: { input: Readable; output: Writable; signal?: AbortSignal },
  launch?: AcpAgentLauncher,
): Promise<number> {
  if (args.length === 1 && args[0] === "--version") {
    io.output.write(`${ACP_HOST_VERSION}\n`);
    return 0;
  }
  const [directory, applicationDirectory] = args;
  if ((args.length !== 1 && args.length !== 2) || !directory || !args.every(isAbsolute))
    throw new Error("ACP 宿主需要应用数据目录的绝对路径");
  io.signal?.throwIfAborted();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // 仅可信原生启动器提供旧应用目录；单参数独立宿主不推测父目录或读取用户文件。
  const host = new AcpHost(
    directory,
    io.output,
    launch,
    applicationDirectory === undefined
      ? undefined
      : (engine) => readAcpLegacyApplicationSettings(applicationDirectory, engine),
    applicationDirectory === undefined
      ? undefined
      : () => readAcpLegacyApplicationPreferences(applicationDirectory),
  );
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
