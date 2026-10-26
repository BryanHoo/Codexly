import { homedir } from "node:os";
import { join } from "node:path";
import { appStorageDirectory } from "@codexly/core/app-storage-paths";
import type {
  checkCodexVersion,
  locateCodexBinary,
  readCodexStartupConfig,
} from "@codexly/provider-codex";
import { parseCommandOptions } from "./cli-command-options.js";
import {
  assertDatabaseDiagnostics,
  type CliManagedStateRepository,
} from "./cli-state-repository.js";
import type { TerminalOutput } from "./terminal-output.js";

export interface CliDoctorDependencies {
  /** 宿主和回归测试可注入隔离目录，生产默认使用用户 ~/.codexly。 */
  appDataDirectory?: string;
  appVersion: string;
  nodeVersion: string;
  checkCodexVersion: typeof checkCodexVersion;
  locateCodexBinary: typeof locateCodexBinary;
  readCodexStartupConfig: typeof readCodexStartupConfig;
  createStateRepository: (
    databasePath: string,
    codexHome?: string,
  ) => Promise<CliManagedStateRepository>;
}

function assertSupportedNodeVersion(version: string): void {
  const major = Number(version.split(".")[0]);
  // CLI 的最低运行时版本与 package.json 的 engines.node 保持一致。
  if (!Number.isInteger(major) || major < 24) {
    throw new Error(`需要 Node.js 24.0.0 或更高版本，当前版本为 ${version}`);
  }
}

export async function runDoctor(
  args: readonly string[],
  dependencies: CliDoctorDependencies,
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
  const codexHome = options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  // 仅显式 doctor 执行：先验证 TOML 和组织策略，失败时无需打开应用数据库或线程存储。
  const startup = await dependencies.readCodexStartupConfig(binary.path, {
    appVersion: dependencies.appVersion,
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  output.success(`Codex 配置预检通过 (${startup.appServerVersion})`);
  output.success(`Codex 配置要求 ${JSON.stringify(startup.configRequirements)}`);
  const applicationDirectory = dependencies.appDataDirectory ?? appStorageDirectory();
  const stateRepository = await dependencies.createStateRepository(
    join(applicationDirectory, "state.sqlite3"),
    codexHome,
  );
  try {
    const diagnostics = await stateRepository.diagnose();
    assertDatabaseDiagnostics(diagnostics);
    output.success(`SQLite 可写 (${join(applicationDirectory, "state.sqlite3")})`);
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
