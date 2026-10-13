import { access, open, readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeAllowedHost } from "@codexly/server";
import { parseCommandOptions, START_VALUE_OPTIONS } from "../cli-command-options.js";
import { listLanAccessUrls } from "../lan-access.js";
import type { TerminalOutput } from "../terminal-output.js";
import {
  type AutostartConfig,
  type AutostartPaths,
  type AutostartPlatform,
  type ConfigRuntime,
  createConfig,
  ensurePrivateDirectory,
  getAutostartPaths,
  readConfig,
  writePrivateJson,
} from "./config.js";
import { createPlatformAdapter, execute, type PlatformAdapter } from "./platform.js";
import {
  configHash,
  type ManagedStartContext,
  queryRuntime,
  readRuntimeState,
  runManaged,
  stopManaged,
} from "./runtime.js";
import { readLogTail } from "./log.js";

export const AUTOSTART_HELP = `Usage: codexly autostart <command> [options]

Manage Web startup after the current user logs in. Never opens a browser.
Requires a stable global npm installation and Node.js 24+.

Commands:
  enable       Register or update login startup; starts on the next login.
  status       Show registration, readiness, actual URLs, and errors.
  logs         Show the last 64 KiB of the bounded background log.
  credentials  Explicitly reveal the saved LAN password.
  restart      Restart the registered service and wait for readiness.
  disable      Unregister and stop the managed instance; retain configuration.
  repair       Refresh Node/package paths, preserving saved startup settings.

Enable options:
  --now                      Apply the configuration and start immediately.
  --lan                      Listen on all interfaces (default: loopback only).
  --port <port>              Initial TCP port (default: 3210); skip occupied ports.
  --lan-password <password>  Save a custom strong LAN password (requires --lan).
                             Otherwise generate once and reuse on future logins.
  --session-ttl <duration>   LAN session lifetime (requires --lan).
  --allowed-host <domain>    Allow an exact proxy domain; may be repeated.
  --codex-bin <path>         Persist an absolute Codex executable path.
  --codex-home <path>        Persist the Codex data directory.
  --workspace <path>         Persist workspace roots; may be repeated.

Repair options:
  --now                      Restart after repairing paths.

Configuration changes apply on restart or next login. LAN sessions end on restart.
Disable before uninstalling the npm package. No administrator privileges required
under normal per-user system policies. Linux linger requires a graphical session.
`;

export interface AutostartCommandContext {
  paths: AutostartPaths;
  platform: AutostartPlatform;
  runtime: ConfigRuntime;
  adapter: PlatformAdapter;
  validateInstallation: () => Promise<void>;
}

export async function validateGlobalInstallation(runtime: ConfigRuntime): Promise<void> {
  const instruction =
    "请先执行 npm install --global @bryanhu/codexly@latest，再使用全局 codexly 配置自启动";
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("自启动需要 Node.js 24 或更高版本");
  if (/(?:^|[/\\])(?:_npx|_pnpx|dlx)(?:[/\\]|$)/u.test(runtime.cli)) throw new Error(instruction);
  const result =
    process.platform === "win32"
      ? await execute("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "& npm.cmd root --global; exit $LASTEXITCODE",
        ])
      : await execute("npm", ["root", "--global"]);
  if (result.code !== 0) throw new Error(`${instruction}（无法读取 npm 全局目录）`);
  const globalRoot = result.stdout.trim();
  try {
    const expected = await realpath(join(globalRoot, "@bryanhu", "codexly", "dist", "cli.js"));
    if ((await realpath(runtime.cli)) !== expected) throw new Error(instruction);
    await access(runtime.node);
    const manifest = JSON.parse(
      await readFile(join(dirname(dirname(expected)), "package.json"), "utf8"),
    ) as { name: string };
    if (manifest.name !== "@bryanhu/codexly") throw new Error(instruction);
    runtime.cli = expected;
  } catch {
    throw new Error(instruction);
  }
}

function defaultContext(): AutostartCommandContext {
  const home = homedir();
  const paths = getAutostartPaths(process.platform, home, process.env);
  const platform = process.platform as AutostartPlatform;
  const runtime = {
    node: process.execPath,
    cli: resolve(process.argv[1] ?? ""),
    home,
    cwd: process.cwd(),
    environment: process.env,
  };
  return {
    paths,
    platform,
    runtime,
    adapter: createPlatformAdapter(platform, paths),
    validateInstallation: () => validateGlobalInstallation(runtime),
  };
}

async function withMutationLock<T>(paths: AutostartPaths, action: () => Promise<T>): Promise<T> {
  await ensurePrivateDirectory(paths.root);
  const lockPath = join(paths.root, "operation.lock");
  let file;
  try {
    file = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // 锁仅保护配置事务，不限制普通 Web 多实例。崩溃遗留锁只在确认原进程不存在后清理。
    const pid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid < 1)
      throw new Error(`自启动操作锁无效，请检查 ${lockPath}`, { cause: error });
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (failure) {
      alive = (failure as NodeJS.ErrnoException).code !== "ESRCH";
    }
    if (alive) throw new Error("另一个自启动配置操作正在运行，请稍后重试", { cause: error });
    await rm(lockPath, { force: true });
    file = await open(lockPath, "wx", 0o600);
  }
  try {
    await file.writeFile(String(process.pid));
    return await action();
  } finally {
    await file.close();
    await rm(lockPath, { force: true });
  }
}

async function register(
  config: AutostartConfig,
  previous: AutostartConfig | undefined,
  context: AutostartCommandContext,
): Promise<void> {
  const { adapter, paths } = context;
  const previouslyEnabled = previous ? (await adapter.status()).enabled : false;
  const prepared = await adapter.prepare(config);
  try {
    await writePrivateJson(paths.config, prepared);
    await adapter.install(prepared);
  } catch (error) {
    try {
      if (previous) {
        await writePrivateJson(paths.config, previous);
        if (previouslyEnabled) await adapter.install(previous);
        else await adapter.remove();
      } else {
        await adapter.remove();
        await rm(paths.config, { force: true });
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `注册失败且回滚未完成，请运行 autostart status 检查。${String(error)}；${String(rollbackError)}`,
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

async function restartAndWait(
  context: AutostartCommandContext,
  output: TerminalOutput,
): Promise<void> {
  if (!(await context.adapter.status()).enabled)
    throw new Error("自启动未启用，请先运行 autostart enable");
  await stopManaged(context.paths);
  const requestedAt = Date.now();
  await context.adapter.restart();
  // 首次 Codex Home 初始化及模型目录预热可能超过 30 秒；等待只发生在管理命令中。
  // 保留有限上限，并继续通过真实监听状态判定就绪，避免把健康的冷启动提前报为失败。
  output.info("正在等待后台服务就绪，首次启动可能较慢（最多等待 120 秒）。");
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const state = await queryRuntime(context.paths);
    if (state?.phase === "ready") {
      output.success(`后台服务已就绪：http://127.0.0.1:${String(state.port)}`);
      return;
    }
    if (!state) {
      const failed = await readRuntimeState(context.paths);
      if (failed?.phase === "failed" && Date.parse(failed.startedAt) >= requestedAt) {
        throw new Error(`后台服务启动失败：${failed.error ?? "请运行 autostart logs"}`);
      }
    }
    await delay(250);
  }
  const last = await readRuntimeState(context.paths);
  throw new Error(
    `服务尚未就绪，请运行 autostart status 或 autostart logs。${last?.error ?? "启动等待超过 120 秒"}`,
  );
}

export async function runAutostartCommand(
  args: readonly string[],
  output: TerminalOutput,
  start: (context: ManagedStartContext) => Promise<number>,
  suppliedContext?: AutostartCommandContext,
): Promise<number> {
  const command = args[0] ?? "";
  const supported = [
    "enable",
    "status",
    "logs",
    "credentials",
    "restart",
    "disable",
    "repair",
    "run",
  ];
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h"].includes(command)) ||
    (args.length === 2 && supported.includes(command) && ["--help", "-h"].includes(args[1] ?? ""))
  ) {
    output.plain(AUTOSTART_HELP);
    return 0;
  }
  if (!command || !supported.includes(command)) throw new Error(`未知自启动命令: ${command}`);
  const context = suppliedContext ?? defaultContext();
  const { paths, runtime, adapter } = context;
  if (command === "run") {
    // 内部入口只接受系统登记的配置文件；保存路径让 XDG 环境与登录终端不一致时仍能找到配置。
    if (args.length !== 3 || args[1] !== "--config" || !args[2] || !isAbsolute(args[2]))
      throw new Error("内部启动入口需要 --config <绝对路径>");
    const configPath = resolve(args[2]);
    const managedPaths = {
      ...paths,
      root: dirname(configPath),
      config: configPath,
      state: join(dirname(configPath), "runtime.json"),
      log: join(dirname(configPath), "service.log"),
    };
    const config = await readConfig(configPath);
    if (!config) throw new Error("自启动配置不存在，请运行 autostart repair");
    return runManaged(config, managedPaths, start);
  }
  const extra = args.slice(1);
  if (!["enable", "repair"].includes(command) && extra.length > 0)
    throw new Error(`未知选项: ${String(extra[0])}`);
  if (command === "logs") {
    output.plain(await readLogTail(paths.log));
    return 0;
  }
  if (command === "credentials") {
    const config = await readConfig(paths.config);
    if (!config?.start.lanPassword) throw new Error("尚未配置 LAN 自启动密码");
    output.plain(`${config.start.lanPassword}\n`);
    return 0;
  }
  if (command === "status") {
    const config = await readConfig(paths.config);
    const registration = await adapter.status();
    const live = await queryRuntime(paths);
    output.info(`登录自启动: ${registration.enabled ? "已启用" : "未启用"}`);
    output.info(`运行状态: ${live?.phase === "ready" ? "已就绪" : live ? "启动中" : "未运行"}`);
    output.info(`配置: ${paths.config}\n日志: ${paths.log}\n系统服务: ${registration.detail}`);
    if (config) {
      output.info(
        `下次启动模式: ${config.start.lan ? "LAN" : "本机"}；起始端口: ${String(config.start.port)}；自动打开浏览器: 否`,
      );
      for (const path of [
        config.node,
        config.cli,
        ...(config.start.codexBin ? [config.start.codexBin] : []),
      ]) {
        try {
          await access(path);
        } catch {
          output.warning(`启动文件不存在: ${path}；请运行 autostart repair 或重新 enable`);
        }
      }
      if (live && live.configHash !== configHash(config))
        output.warning("保存的配置尚未应用到运行实例，请运行 autostart restart。");
    }
    if (live) {
      output.info(
        `PID: ${String(live.pid)}；启动时间: ${live.startedAt}；运行模式: ${live.lan ? "LAN" : "本机"}`,
      );
      if (live.port)
        output.info(
          [
            `http://127.0.0.1:${String(live.port)}`,
            ...(live.lan ? listLanAccessUrls(live.port) : []),
          ].join("\n"),
        );
    } else {
      const previous = await readRuntimeState(paths);
      if (previous?.error) output.warning(`最近错误: ${previous.error}`);
      else if (previous && ["ready", "starting"].includes(previous.phase))
        output.warning("上次进程已退出或控制通道不可用，请查看日志和系统服务状态。");
    }
    return 0;
  }
  // 先解析参数，避免拼写错误也创建文件或改变系统登记。
  const { now, ...options } = parseCommandOptions(
    extra,
    command === "enable" ? START_VALUE_OPTIONS : new Set(),
    command === "enable" ? new Set(["--lan", "--now"]) : new Set(["--now"]),
  );
  return withMutationLock(paths, async () => {
    if (command === "disable") {
      await stopManaged(paths);
      await adapter.remove();
      output.success("已停止托管实例并取消登录自启动；配置和凭据保留。");
      return 0;
    }
    if (command === "restart") {
      await restartAndWait(context, output);
      return 0;
    }
    await context.validateInstallation();
    const previous = await readConfig(paths.config);
    if (command === "repair" && !previous)
      throw new Error("没有可修复的自启动配置，请先运行 autostart enable");
    const config =
      command === "repair" && previous
        ? {
            ...previous,
            node: runtime.node,
            cli: runtime.cli,
            environment: runtime.environment["PATH"] ? { PATH: runtime.environment["PATH"] } : {},
          }
        : createConfig(options, runtime, previous);
    if (config.start.allowedHosts)
      config.start.allowedHosts = config.start.allowedHosts.map(normalizeAllowedHost);
    if (config.start.codexBin) await access(config.start.codexBin);
    await register(config, previous, context);
    output.success(
      command === "repair" ? "已修复自启动路径。" : "已配置用户登录自启动，默认不打开浏览器。",
    );
    if (config.start.lan)
      output.info("LAN 密码已保存在用户私有配置中；使用 autostart credentials 查看。");
    if (now) await restartAndWait(context, output);
    else output.info("配置将在下次登录或 autostart restart 后生效。");
    return 0;
  });
}
