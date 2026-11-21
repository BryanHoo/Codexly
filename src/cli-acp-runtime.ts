import { join } from "node:path";
import type { AgentRuntimeProvider, LocalCatalogStore } from "@codexly/core";
import {
  AcpApplicationRuntime,
  importAcpLegacyGlobalInstructions,
  readAcpLegacyApplicationSettings,
  type AcpAgentLauncher,
} from "@codexly/provider-acp";
import type { CliManagedStateRepository } from "./cli-state-repository.js";

export interface CliAcpRuntime extends AgentRuntimeProvider {
  close(): Promise<void>;
}
export interface CreateCliAcpRuntimeInput {
  applicationDirectory: string;
  store: CliManagedStateRepository & LocalCatalogStore;
  environment: NodeJS.ProcessEnv;
  launch?: AcpAgentLauncher;
}

/** CLI 与桌面共用同一 ACP 实现；旧应用文件和 SQLite 偏好只读导入，不启动旧执行端口。 */
export async function createCliAcpRuntime(input: CreateCliAcpRuntimeInput): Promise<CliAcpRuntime> {
  try {
    await importAcpLegacyGlobalInstructions(input.store, input.environment, () =>
      input.store.readGlobalSettings(),
    );
  } catch {
    // 原文件保持完整，后续启动可重试；日志不输出用户指令正文或路径。
    process.stderr.write("无法导入旧全局指令，原文件已保留。\n");
  }
  return new AcpApplicationRuntime(
    join(input.applicationDirectory, "engines", "acp"),
    input.store,
    () => input.store.readGlobalSettings(),
    input.launch,
    async (engine) => {
      const source = await readAcpLegacyApplicationSettings(input.applicationDirectory, engine);
      return engine === "codex"
        ? {
            ...source,
            settings: { ...source.settings, ...(await input.store.readGlobalSettings()) },
          }
        : source;
    },
    input.environment,
  );
}
