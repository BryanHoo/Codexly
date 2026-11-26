import { homedir } from "node:os";
import { join } from "node:path";
import { appStorageDirectory } from "@codexly/core/app-storage-paths";
import type { inspectOfficialAcpAgents } from "@codexly/provider-acp";
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
  inspectAcpAgents: typeof inspectOfficialAcpAgents;
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

  const codexHome = options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const agents = await dependencies.inspectAcpAgents({
    ...process.env,
    CODEX_HOME: codexHome,
    ...(options.codexBin ? { CODEX_PATH: options.codexBin } : {}),
  });
  for (const agent of agents)
    output.success(`ACP ${agent.engine} 协议 v${String(agent.protocolVersion)} (${agent.name})`);
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
