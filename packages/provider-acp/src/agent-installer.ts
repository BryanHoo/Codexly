import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { selectRegistryOrder } from "@codexly/core";
import { findAgentExecutable, type AgentCommand } from "./agent-executable.js";
import type { AcpAgentInstallationStage } from "@codexly/protocol";
import { extractAgentZip } from "./agent-zip.js";
const execute = promisify(execFile);
const INSTALL_TIMEOUT_MS = 300_000;
/** 宿主可回传此类型的 message，子进程原始输出只保留在内部 cause 中。 */
export class NpmAgentInstallError extends Error {}

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
  report?: (progress: AcpAgentInstallationStage) => void,
): Promise<AgentCommand> {
  const run = (
    command: string,
    args: string[],
    timeout = INSTALL_TIMEOUT_MS,
    killSignal: NodeJS.Signals = "SIGTERM",
  ) =>
    execute(command, args, {
      ...(signal ? { signal } : {}),
      env: environment,
      timeout,
      killSignal,
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
      const [nodePath, executable] = await Promise.all([
        findAgentExecutable("node", environment),
        findAgentExecutable("npm", environment),
      ]);
      if (!nodePath || !executable) throw new Error("请安装 Node.js（包含 npm）后重试");
      // fnm 等版本管理器的 PATH 可能指向临时链接，持久化真实 Node 路径供重启后使用。
      const node = await realpath(nodePath);
      // Windows 的 npm.cmd 不是可直接 spawn 的程序，使用 Node 运行 npm CLI，始终关闭 shell。
      const cli =
        process.platform === "win32"
          ? join(dirname(executable), "node_modules", "npm", "bin", "npm-cli.js")
          : await realpath(executable);
      report?.({ stage: "installing" });
      const separator = npm.package.lastIndexOf("@");
      const name = npm.package.slice(0, separator);
      const version = npm.package.slice(separator + 1);
      const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
      const deadline = performance.now() + INSTALL_TIMEOUT_MS;
      // 按目标版本测速，避免只因镜像可达就选中尚未同步该版本的源。
      const registries = await selectRegistryOrder(
        signal,
        `/${name.replace("/", "%2f")}/${version}`,
      );
      for (const [index, registry] of registries.entries()) {
        signal?.throwIfAborted();
        const remaining = Math.ceil(deadline - performance.now());
        if (remaining <= 0) throw new NpmAgentInstallError(`npm 安装 ${npm.package} 超时`);
        // 两个源共用总时限。首个 npm 进程最多用掉剩余预算的一半，请求级超时无法限制整个进程。
        const attemptsLeft = registries.length - index;
        const timeout = Math.max(1, Math.floor(remaining / attemptsLeft));
        try {
          await run(
            node,
            [
              cli,
              "install",
              `--registry=${registry}`,
              ...(scope ? [`--${scope}:registry=${registry}`] : []),
              "--fetch-retries=0",
              "--fetch-timeout=30000",
              "--prefix",
              stage,
              "--no-audit",
              "--no-fund",
              "--omit=dev",
              "--",
              npm.package,
            ],
            timeout,
            // 到点直接结束 npm，避免进程继续处理或忽略 SIGTERM，耗掉下一次尝试的预算。
            "SIGKILL",
          );
          break;
        } catch (error) {
          signal?.throwIfAborted();
          if (performance.now() >= deadline)
            throw new NpmAgentInstallError(`npm 安装 ${npm.package} 超时`, { cause: error });
          if (attemptsLeft === 1) {
            // 对外只提供 npm 错误码，原始 stderr 可能含私有路径、代理或凭据。
            const stderr = (error as { stderr?: string }).stderr;
            const code = stderr?.match(/^npm (?:error|ERR!) code ([A-Z0-9_-]{1,32})\s*$/m)?.[1];
            throw new NpmAgentInstallError(
              `npm 安装 ${npm.package} 失败（已尝试官方源和国内镜像${code ? `，${code}` : ""}）`,
              { cause: error },
            );
          }
          // 首次 npm 安装可能已写入锁文件或部分依赖，切源前清空暂存目录，保留 npm 缓存。
          await rm(stage, { recursive: true, force: true });
          await mkdir(stage, { mode: 0o700 });
        }
      }
      const manifest = JSON.parse(
        await readFile(join(stage, "node_modules", name, "package.json"), "utf8"),
      ) as { bin?: string | Record<string, string> };
      const entry =
        typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
      if (!entry || isAbsolute(entry) || entry.split(/[\\/]/).includes(".."))
        throw new Error("Agent 缺少有效的可执行入口");
      const relativeEntry = join("node_modules", name, entry);
      if (!(await stat(join(stage, relativeEntry)).catch(() => undefined))?.isFile())
        throw new Error("Agent 安装包缺少可执行入口");
      const installedEntry = join(destination, relativeEntry);
      // CodeFree O 的 npm 包在各平台均以 .exe 文件发布原生入口，需要由宿主直接启动。
      const native = /\.exe$/i.test(entry);
      result = {
        command: native ? installedEntry : node,
        args: native ? (npm.args ?? []) : [installedEntry, ...(npm.args ?? [])],
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
      report?.({ stage: "installing" });
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
      report?.({ stage: "downloading", received: 0 });
      const timeout = AbortSignal.timeout(180_000);
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok || !response.body) throw new Error("Agent 下载失败");
      const archive = join(stage, "download.archive");
      let size = 0;
      let lastReport = 0;
      // 目录中的 Antigravity Linux x64 ZIP 约 261 MiB；保留有界下载预算并覆盖真实发布包。
      const limit = 512 * 1024 * 1024;
      const length = Number(response.headers.get("content-length"));
      // Fetch 会解码压缩响应，只有原始字节数与响应头一致时才可使用该总量。
      const lengthKnown =
        !response.headers.has("content-encoding") &&
        Number.isSafeInteger(length) &&
        length > 0 &&
        length <= limit;
      const downloading = () =>
        report?.({
          stage: "downloading",
          received: size,
          ...(lengthKnown && size <= length ? { total: length } : {}),
        });
      downloading();
      const digest = createHash("sha256");
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > limit) {
              callback(new Error("Agent 安装包超过大小限制"));
              return;
            }
            digest.update(chunk);
            const now = Date.now();
            if (now - lastReport >= 200) {
              lastReport = now;
              downloading();
            }
            callback(null, chunk);
          },
        }),
        createWriteStream(archive, { flags: "wx", mode: 0o600 }),
      );
      if (spec.sha256) report?.({ stage: "verifying" });
      if (spec.sha256 && digest.digest("hex") !== spec.sha256.toLowerCase())
        throw new Error("Agent 安装包校验失败");
      const command = resolve(stage, spec.cmd);
      if (relative(stage, command).startsWith("..") || isAbsolute(relative(stage, command)))
        throw new Error("Agent 入口超出安装目录");
      if (/\.zip$/i.test(url.pathname)) {
        report?.({ stage: "extracting" });
        await extractAgentZip(archive, stage, signal);
        await rm(archive);
      } else if (/\.(tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(url.pathname)) {
        report?.({ stage: "extracting" });
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
    report?.({ stage: "publishing" });
    await mkdir(dirname(destination), { recursive: true });
    signal?.throwIfAborted();
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
