import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { findAgentExecutable, type AgentCommand } from "./agent-executable.js";
const execute = promisify(execFile);
interface Spec {
  args?: string[];
  env?: Record<string, string>;
}
interface Binary extends Spec {
  archive: string;
  cmd: string;
  sha256?: string;
}
export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  distribution: {
    npx?: Spec & { package: string };
    uvx?: Spec & { package: string };
    binary?: Record<string, Binary>;
  };
}
/** 安装到应用私有目录，成功后原子发布；不改变全局 npm/Python 环境。 */
export async function installRegistryAgent(
  agent: RegistryAgent,
  destination: string,
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<AgentCommand> {
  const run = (command: string, args: string[]) =>
    execute(command, args, {
      ...(signal ? { signal } : {}),
      env: environment,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  const stage = `${destination}.stage-${randomUUID()}`;
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    let result: AgentCommand;
    const npm = agent.distribution.npx;
    if (npm) {
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+@[0-9][a-zA-Z0-9.+-]*$/.test(npm.package))
        throw new Error("目录 npm 包必须固定版本");
      const node = await findAgentExecutable("node", environment);
      const executable = await findAgentExecutable("npm", environment);
      if (!node || !executable) throw new Error("请安装 Node.js（包含 npm）后重试");
      // Windows 的 npm.cmd 不是可直接 spawn 的程序，使用 Node 运行 npm CLI，始终关闭 shell。
      const cli =
        process.platform === "win32"
          ? join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js")
          : await realpath(executable);
      await run(node, [
        cli,
        "install",
        "--prefix",
        stage,
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        "--",
        npm.package,
      ]);
      const name = npm.package.slice(0, npm.package.lastIndexOf("@"));
      const manifest = JSON.parse(
        await readFile(join(stage, "node_modules", name, "package.json"), "utf8"),
      ) as { bin?: string | Record<string, string> };
      const entry =
        typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
      if (!entry || isAbsolute(entry) || entry.split(/[\\/]/).includes(".."))
        throw new Error("Agent 缺少有效的可执行入口");
      result = {
        command: node,
        args: [join(destination, "node_modules", name, entry), ...(npm.args ?? [])],
        ...(npm.env ? { env: npm.env } : {}),
      };
    } else if (agent.distribution.uvx) {
      const spec = agent.distribution.uvx;
      const uv = await findAgentExecutable("uv", environment);
      if (!uv) throw new Error("请安装 uv 后重试，或配置已有 Agent 命令");
      const pinned = spec.package.replace(/@([0-9][^@]*)$/, "==$1");
      if (!/^[a-zA-Z0-9._-]+==[0-9][a-zA-Z0-9.+-]*$/.test(pinned))
        throw new Error("目录 Python 包必须固定版本");
      const packageName = pinned.split("==")[0] ?? "";
      // uv 缓存负责虚拟环境和并发，不搬迁带有绝对 shebang 的 Python 环境。
      const probe = await run(uv, [
        "tool",
        "run",
        "--from",
        pinned,
        "--",
        "python3",
        "-c",
        `import importlib.metadata as m; print(next(e.name for e in m.distribution(${JSON.stringify(packageName)}).entry_points if e.group == 'console_scripts'))`,
      ]);
      const bin = probe.stdout.trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(bin)) throw new Error("Agent 没有有效的 Python 命令入口");
      result = {
        command: uv,
        args: ["tool", "run", "--from", pinned, "--", bin, ...(spec.args ?? [])],
        ...(spec.env ? { env: spec.env } : {}),
      };
    } else {
      const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
      const os = process.platform === "win32" ? "windows" : process.platform;
      const musl =
        process.platform === "linux" &&
        !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header
          .glibcVersionRuntime;
      const spec = agent.distribution.binary?.[`${os}-${arch}${musl ? "-musl" : ""}`];
      if (!spec) throw new Error("此 Agent 没有当前系统的安装包，请配置本机 ACP 命令");
      const url = new URL(spec.archive);
      if (url.protocol !== "https:") throw new Error("Agent 下载地址必须使用 HTTPS");
      const timeout = AbortSignal.timeout(180_000);
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok || !response.body) throw new Error("Agent 下载失败");
      const archive = join(stage, "download.archive");
      let size = 0;
      const digest = createHash("sha256");
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > 256 * 1024 * 1024) {
              callback(new Error("Agent 安装包超过大小限制"));
              return;
            }
            digest.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(archive, { flags: "wx", mode: 0o600 }),
      );
      if (spec.sha256 && digest.digest("hex") !== spec.sha256.toLowerCase())
        throw new Error("Agent 安装包校验失败");
      const command = resolve(stage, spec.cmd);
      if (relative(stage, command).startsWith("..") || isAbsolute(relative(stage, command)))
        throw new Error("Agent 入口超出安装目录");
      if (/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(url.pathname)) {
        const { stdout } = await run("tar", ["-tf", archive]);
        if (
          stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .some(
              (p) =>
                isAbsolute(p) ||
                p.includes("\\") ||
                p.split("/").includes("..") ||
                /^[A-Za-z]:/.test(p),
            )
        )
          throw new Error("Agent 压缩包包含无效路径");
        const verbose = await run("tar", ["-tvf", archive]);
        if (
          verbose.stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .some((line) => !/^[-d]/.test(line))
        )
          throw new Error("Agent 压缩包包含链接或特殊文件");
        await run("tar", ["-xf", archive, "-C", stage]);
        await rm(archive);
      } else {
        await mkdir(dirname(command), { recursive: true });
        await rename(archive, command);
      }
      if (!(await stat(command)).isFile()) throw new Error("安装包缺少 ACP 可执行入口");
      await chmod(command, 0o700);
      result = {
        command: resolve(destination, spec.cmd),
        args: spec.args ?? [],
        ...(spec.env ? { env: spec.env } : {}),
      };
    }
    await mkdir(dirname(destination), { recursive: true });
    signal?.throwIfAborted();
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
