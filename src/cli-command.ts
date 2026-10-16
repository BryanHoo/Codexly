import { prepareLocalCatalog } from "./cli-local-catalog.js";
import type { ManagedStartContext } from "./autostart/runtime.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentRuntimeProvider,
  LocalCatalogStore,
  ProjectProjectionStore,
  ProjectRepository,
  WorkbenchPetProvider,
} from "@codexly/core";
import { DEFAULT_COMMIT_MESSAGE_MODEL, type AppUpdateProgress } from "@codexly/protocol";
import {
  checkCodexVersion,
  createCodexRuntimeProvider,
  createCodexWorkbenchPetProvider,
  locateCodexBinary,
  startCodexAppServer,
  type CreateCodexWorkbenchPetProviderOptions,
  type CodexBinary,
  type CodexProcessExit,
  type CodexRpcClient,
  type CodexVersionInfo,
  type LocateCodexBinaryOptions,
  type StartCodexAppServerOptions,
} from "@codexly/provider-codex";
import {
  createCodexlyServer,
  normalizeAllowedHost,
  SqliteStateRepository,
  LocalProjectRepository,
  type SqliteDatabaseDiagnostics,
} from "@codexly/server";
import packageManifest from "../package.json" with { type: "json" };
import { createAppUpdateService } from "./app-update.js";
import {
  parseStartOptions,
  CLI_COMMAND_HELP,
  CLI_HELP,
  parseCommandOptions,
  type ParsedCommandOptions,
} from "./cli-command-options.js";
import { createProcessShutdownSignal, waitForAbort } from "./cli-shutdown.js";
import { listenOnAvailablePort } from "./cli-server-listen.js";
import type { CreateServerInput } from "./cli-server-input.js";
import type { CliManagedStateRepository } from "./cli-state-repository.js";
import {
  confirmTerminalAppUpdate,
  createStartupAppUpdateOperations,
  formatTerminalAppUpdateProgress,
  restartCliAfterUpdate,
  STARTUP_UPDATE_APPLIED_ENV,
  type StartupAppUpdateCheck,
} from "./cli-startup-update.js";
import { openSystemBrowser } from "./system-browser.js";
import { createTerminalOutput, type TerminalOutput } from "./terminal-output.js";
import {
  generateLanPairingCode,
  listLanAccessUrls,
  parseSessionTtl,
  validateLanPassword,
} from "./lan-access.js";
interface CliManagedRuntime {
  client: CodexRpcClient;
  close: () => Promise<void>;
  version: CodexVersionInfo;
  waitForExit: () => Promise<CodexProcessExit>;
}

interface CliManagedServer {
  close: () => Promise<void>;
  listen: (options: { host: string; port: number }) => Promise<string>;
}

interface CliManagedProjectRepository extends ProjectRepository {
  migrateLegacyProjects(options: { recoverUnassigned: boolean }): Promise<void>;
  synchronize(): ReturnType<ProjectRepository["list"]>;
}

interface CreateRuntimeProviderInput {
  readTaskTitleModel: () => Promise<string>;
  codexHome?: string;
  client: CodexRpcClient;
  modelCatalogRuntimeFactory?: () => Promise<CliManagedRuntime>;
}

export interface CliDependencies {
  appVersion: string;
  checkAppUpdate: () => Promise<StartupAppUpdateCheck>;
  checkCodexVersion: (binaryPath: string) => Promise<CodexVersionInfo>;
  confirmAppUpdate: (currentVersion: string, latestVersion: string) => Promise<boolean>;
  createProjectRepository: (input: {
    client: CodexRpcClient;
    projection: ProjectProjectionStore;
  }) => CliManagedProjectRepository;
  createPetProvider: (input: CreateCodexWorkbenchPetProviderOptions) => WorkbenchPetProvider;
  createStateRepository: (databasePath: string) => Promise<CliManagedStateRepository>;
  createRuntimeProvider: (
    input: CreateRuntimeProviderInput,
  ) => AgentRuntimeProvider | Promise<AgentRuntimeProvider>;
  createServer: (input: CreateServerInput) => Promise<CliManagedServer>;
  generateLanPairingCode: () => string;
  listLanAccessUrls: (port: number) => readonly string[];
  locateCodexBinary: (options?: LocateCodexBinaryOptions) => Promise<CodexBinary>;
  nodeVersion: string;
  openBrowser: (url: string) => Promise<void>;
  installAppUpdate: (
    version: string,
    onProgress?: (progress: AppUpdateProgress) => void,
  ) => Promise<void>;
  restartAfterUpdate: (args: readonly string[]) => Promise<number>;
  startCodexAppServer: (options?: StartCodexAppServerOptions) => Promise<CliManagedRuntime>;
  webRoot: string;
}

export interface RunCliOptions {
  color?: boolean;
  dependencies?: CliDependencies;
  signal?: AbortSignal;
  stderr?: (message: string) => void;
  stdout?: (message: string) => void;
}

const startupAppUpdate = createStartupAppUpdateOperations(packageManifest.version);

const defaultDependencies: CliDependencies = {
  appVersion: packageManifest.version,
  checkAppUpdate: startupAppUpdate.check,
  checkCodexVersion,
  confirmAppUpdate: confirmTerminalAppUpdate,
  createProjectRepository: ({ projection }) =>
    new LocalProjectRepository(
      projection as CliManagedStateRepository & LocalCatalogStore,
      projection,
    ),
  createPetProvider: createCodexWorkbenchPetProvider,
  createStateRepository: (databasePath) => SqliteStateRepository.open(databasePath),
  createRuntimeProvider: createCodexRuntimeProvider,
  createServer: async (input) => {
    const server = await createCodexlyServer({
      ...input,
    });
    return {
      close: () => server.close(),
      listen: (options) => server.listen(options),
    };
  },
  generateLanPairingCode,
  listLanAccessUrls,
  locateCodexBinary,
  nodeVersion: process.versions.node,
  openBrowser: openSystemBrowser,
  installAppUpdate: startupAppUpdate.install,
  restartAfterUpdate: restartCliAfterUpdate,
  startCodexAppServer,
  webRoot: fileURLToPath(new URL("../dist/web", import.meta.url)),
};

function assertSupportedNodeVersion(version: string): void {
  const major = Number(version.split(".")[0]);
  // CLI 的最低运行时版本与 package.json 的 engines.node 保持一致。
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`需要 Node.js 24.0.0 或更高版本，当前版本为 ${version}`);
  }
}

function resolveCodexHome(options: ParsedCommandOptions): string {
  return options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
}

function assertDatabaseDiagnostics(diagnostics: SqliteDatabaseDiagnostics): void {
  if (!diagnostics.writable) {
    throw new Error("SQLite database is not writable");
  }
  if (diagnostics.migrationVersion < 1) {
    throw new Error("SQLite migrations are not applied");
  }
  if (diagnostics.integrityCheck !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${diagnostics.integrityCheck}`);
  }
  if (diagnostics.journalMode.toLocaleLowerCase() !== "wal") {
    throw new Error(`SQLite journal_mode must be WAL; found ${diagnostics.journalMode}`);
  }
  if (
    !diagnostics.foreignKeys ||
    diagnostics.synchronous !== "normal" ||
    diagnostics.busyTimeout !== 5_000
  ) {
    throw new Error("SQLite PRAGMA configuration is invalid");
  }
}

async function runDoctor(
  args: readonly string[],
  dependencies: CliDependencies,
  output: TerminalOutput,
): Promise<number> {
  const options = parseCommandOptions(args, new Set(["--codex-bin", "--codex-home"]));
  assertSupportedNodeVersion(dependencies.nodeVersion);
  output.success(`Node.js ${dependencies.nodeVersion}`);

  const binary = await dependencies.locateCodexBinary(
    options.codexBin ? { explicitPath: options.codexBin } : {},
  );
  const version = await dependencies.checkCodexVersion(binary.path);
  output.success(`Codex ${version.version} (${binary.path})`);
  const codexHome = resolveCodexHome(options);
  const stateRepository = await dependencies.createStateRepository(
    join(codexHome, "codexly", "state.sqlite3"),
  );
  try {
    const diagnostics = await stateRepository.diagnose();
    assertDatabaseDiagnostics(diagnostics);
    output.success(`SQLite 可写 (${join(codexHome, "codexly", "state.sqlite3")})`);
    output.success(`SQLite migration ${String(diagnostics.migrationVersion)}`);
    output.success(`SQLite integrity_check ${diagnostics.integrityCheck}`);
    output.success(`SQLite journal_mode ${diagnostics.journalMode}`);
    output.success(
      `SQLite PRAGMA foreign_keys=ON synchronous=NORMAL busy_timeout=${String(diagnostics.busyTimeout)}`,
    );
  } finally {
    await stateRepository.close();
  }
  return 0;
}

export async function runStart(
  args: readonly string[],
  dependencies: CliDependencies,
  signal: AbortSignal | undefined,
  output: TerminalOutput,
  managed?: Pick<ManagedStartContext, "options" | "environment" | "background" | "onReady">,
): Promise<number> {
  const environment = managed?.environment ?? process.env;
  // 托管实例只使用已保存的参数，避免登录环境里的 CODEXLY_* 改变服务行为。
  const options = managed?.options ?? parseStartOptions(args, environment);
  if (options.sessionTtl !== undefined && options.lan !== true) {
    throw new Error("--session-ttl 只能与 --lan 一起使用");
  }
  if (options.lanPassword !== undefined && options.lan !== true) {
    throw new Error("--lan-password 只能与 --lan 一起使用");
  }
  if (options.lanPassword !== undefined) {
    validateLanPassword(options.lanPassword);
  }
  const allowedHosts = options.allowedHosts?.map(normalizeAllowedHost);
  const port = options.port ?? 3210;
  const sessionTtlMs = options.sessionTtl ? parseSessionTtl(options.sessionTtl) : undefined;
  const access =
    options.lan !== true
      ? undefined
      : {
          pairingCode: options.lanPassword ?? dependencies.generateLanPairingCode(),
          ...(sessionTtlMs === undefined ? {} : { sessionTtlMs }),
        };

  if (!managed?.background && process.env[STARTUP_UPDATE_APPLIED_ENV] !== "1") {
    const update = await dependencies.checkAppUpdate();
    if (update.status === "check-failed") {
      output.warning("无法检查 Codexly 更新，将继续启动当前版本。");
    } else if (update.status === "available" && update.latestVersion !== null) {
      const shouldUpdate = await dependencies.confirmAppUpdate(
        dependencies.appVersion,
        update.latestVersion,
      );
      if (shouldUpdate) {
        output.info(`正在更新 Codexly 到 ${update.latestVersion}...`);
        await dependencies.installAppUpdate(update.latestVersion, (progress) => {
          output.info(formatTerminalAppUpdateProgress(progress));
        });
        output.success(`Codexly 已更新到 ${update.latestVersion}，正在重新启动。`);
        return dependencies.restartAfterUpdate(["start", ...args]);
      }
      output.info("已跳过更新，继续启动当前版本。");
    }
  }

  const ownedShutdown = signal ? null : createProcessShutdownSignal();
  const shutdownSignal = signal ?? ownedShutdown?.signal;
  if (!shutdownSignal) {
    throw new Error("Shutdown signal is unavailable");
  }

  let runtime: CliManagedRuntime | undefined;
  let server: CliManagedServer | undefined;
  let stateRepository: CliManagedStateRepository | undefined;

  try {
    const codexHome = resolveCodexHome(options);
    // 启动位置不参与内部运行：多个 Web 实例共用 Codex Home，由端口和业务事务处理并发。
    const runtimeCwd = homedir();
    const env = {
      ...environment,
      ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {}),
    };
    stateRepository = await dependencies.createStateRepository(
      join(codexHome, "codexly", "state.sqlite3"),
    );
    const startupStateRepository = stateRepository;
    const startRuntime = () => {
      const initialize = () =>
        dependencies.startCodexAppServer({
          appVersion: dependencies.appVersion,
          cwd: runtimeCwd,
          env,
          ...(options.codexBin ? { binaryPath: options.codexBin } : {}),
        });
      // 上游首次创建 SQLite 状态也存在竞争；只串行化握手，运行期间不持有目录锁。
      return startupStateRepository.withScheduledTaskLock === undefined
        ? initialize()
        : startupStateRepository.withScheduledTaskLock(initialize);
    };
    runtime = await startRuntime();
    const catalogClient = await prepareLocalCatalog(runtime.client, stateRepository);
    const projectRepository = dependencies.createProjectRepository({
      client: catalogClient,
      projection: stateRepository,
    });
    const projectSourceMigration = await stateRepository.readProjectSourceMigration();
    if (!projectSourceMigration.completed) {
      await projectRepository.migrateLegacyProjects({
        recoverUnassigned: projectSourceMigration.recoverUnassigned,
      });
    }
    await projectRepository.synchronize();
    if (!projectSourceMigration.completed) {
      await stateRepository.completeProjectSourceMigration();
    }
    const codexProvider = await dependencies.createRuntimeProvider({
      codexHome,
      client: catalogClient,
      modelCatalogRuntimeFactory: startRuntime,
      // 标题与提交信息共用应用模型设置，按需读取最新值，不阻塞首次发送。
      readTaskTitleModel: async () =>
        (await startupStateRepository.readGlobalSettings())?.commitMessageModel ??
        DEFAULT_COMMIT_MESSAGE_MODEL,
    });
    const provider = enableClaudeRuntime(codexProvider, stateRepository, codexHome);
    const petProvider = dependencies.createPetProvider({ codexHome });
    const appUpdateService = createAppUpdateService({
      appVersion: dependencies.appVersion,
      codexVersion: runtime.version.version,
    });
    server = await dependencies.createServer({
      // 托管运行复用已有日志目的地，HTTP 与 Provider 诊断也进入脱敏且有上限的后台日志。
      ...(managed?.background ? { logDestination: { write: output.plain } } : {}),
      ...(access === undefined ? {} : { access }),
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      projectRepository,
      providerConnectionRepository: stateRepository,
      provider,
      preloadModelCatalog: true,
      petProvider,
      installAppUpdate: appUpdateService.install,
      readAppInfo: appUpdateService.read,
      readAppUpdateProgress: appUpdateService.readProgress,
      queueRepository: stateRepository,
      scheduledTaskAttachmentRepository: stateRepository,
      scheduledTaskRepository: stateRepository,
      submissionRepository: stateRepository,
      asyncQuestionRepository: stateRepository,
      projectTodoRepository: stateRepository,
      settingsRepository: stateRepository,
      staticRoot: dependencies.webRoot,
      // 显式工作区仍控制临时任务边界；未配置时使用稳定的用户目录，不继承终端目录。
      standaloneCwd: options.workspaceRoots?.[0] ?? runtimeCwd,
      ...(options.workspaceRoots === undefined ? {} : { workspaceRoots: options.workspaceRoots }),
    });
    const host = options.lan === true ? "0.0.0.0" : "127.0.0.1";
    const activePort = await listenOnAvailablePort(server, host, port);
    if (activePort !== port) {
      output.warning(`端口 ${String(port)} 已被占用，已自动切换到端口 ${String(activePort)}。`);
    }
    await managed?.onReady({ host, port: activePort });
    output.success("Codexly 已启动");

    if (access !== undefined) {
      const urls = dependencies.listLanAccessUrls(activePort);
      output.warning("局域网模式使用未加密的 HTTP，请仅在可信网络中使用。");
      if (urls.length === 0) {
        output.warning("未找到可用的局域网 IPv4 地址，服务仍在运行。");
      } else {
        output.info(`局域网访问地址:\n${urls.map((url) => `  ${url}`).join("\n")}`);
      }
      if (options.lanPassword === undefined) {
        output.info(`配对码: ${access.pairingCode}`);
      } else {
        output.info("已使用自定义访问密码（不会在终端回显）。");
      }
      output.info(
        options.sessionTtl === undefined
          ? "会话有效期: 永不过期（仅当前进程）"
          : `会话有效期: ${options.sessionTtl}（固定期限，不自动续期）`,
      );
      output.info(
        options.lanPassword === undefined
          ? "重启 Codexly 后，当前配对码和所有局域网会话将失效。"
          : "重启 Codexly 后，所有局域网会话将失效；固定访问密码保持有效。",
      );
    } else {
      output.info(`访问地址: http://127.0.0.1:${String(activePort)}`);
    }

    if (!managed?.background && options.lan !== true && options.noOpen !== true) {
      try {
        await dependencies.openBrowser(`http://127.0.0.1:${String(activePort)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.warning(`无法自动打开浏览器，请手动访问上述地址。原因: ${message}`);
      }
    }

    // 同时观察退出信号和子进程，避免 App Server 崩溃后 CLI 继续空等。
    const outcome = await Promise.race([
      runtime.waitForExit().then((exit) => ({ exit, type: "process-exit" as const })),
      waitForAbort(shutdownSignal).then(() => ({ type: "shutdown" as const })),
    ]);
    if (outcome.type === "process-exit") {
      const reason = outcome.exit.signal
        ? `信号 ${outcome.exit.signal}`
        : `退出码 ${String(outcome.exit.code)}`;
      throw new Error(`Codex App Server 在 Codexly 关闭前意外退出，${reason}`);
    }
    return 0;
  } finally {
    // 每层 finally 都保证后续资源被回收，避免单个关闭错误遗留长驻进程。
    try {
      await server?.close();
    } finally {
      try {
        await stateRepository?.close();
      } finally {
        try {
          await runtime?.close();
        } finally {
          ownedShutdown?.cleanup();
        }
      }
    }
  }
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const colorEnabled =
    options.color ?? (process.stdout.isTTY && process.env["NO_COLOR"] === undefined);
  const output = createTerminalOutput(stdout, stderr, colorEnabled);
  const [requestedCommand, ...rawArgs] = argv;
  // 空参数使用主启动流程，使直接执行 `codexly` 与显式 `codexly start` 完全一致。
  const command = requestedCommand ?? "start";
  // `pnpm run <script> -- ...` 会把分隔符传给脚本；只剥离命令后的首个分隔符。
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

  try {
    if (command === "autostart") {
      const { runAutostartCommand } = await import("./autostart/command.js");
      return await runAutostartCommand(args, output, (context) =>
        runStart([], dependencies, context.signal, context.output, context),
      );
    }
    // 全局标志只接受独立调用；子命令帮助必须位于命令之后。
    if (
      command === "--help" ||
      command === "-h" ||
      (!command.startsWith("-") && (args[0] === "--help" || args[0] === "-h"))
    ) {
      if (args.length > (command.startsWith("-") ? 0 : 1)) {
        throw new Error(`未知选项: ${args[command.startsWith("-") ? 0 : 1] ?? "<empty>"}`);
      }
      const help = command.startsWith("-") ? CLI_HELP : CLI_COMMAND_HELP[command];
      if (!help) throw new Error(`未知命令: ${command}`);
      output.plain(help);
      return 0;
    }
    if (command === "version" || command === "--version" || command === "-V") {
      if (args.length > 0) throw new Error(`未知选项: ${args[0] ?? "<empty>"}`);
      output.plain(`codexly ${dependencies.appVersion}\n`);
      return 0;
    }
    if (command === "doctor") {
      return await runDoctor(args, dependencies, output);
    }
    if (command === "start") {
      return await runStart(args, dependencies, options.signal, output);
    }
    throw new Error(`未知命令: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(message);
    return 1;
  }
}
import { enableClaudeRuntime } from "./cli-engine-runtime.js";
